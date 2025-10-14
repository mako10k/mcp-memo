#!/usr/bin/env bun
import process from "node:process";
import { writeFile } from "node:fs/promises";

import type { MemorySearchResponse, RelationGraphResponse } from "../packages/shared/src/index";
import { MemoryHttpBridge } from "../packages/stdio/src/httpBridge";
import { loadConfig } from "../packages/stdio/src/config";

interface CliOptions {
  namespace?: string;
  pivots: string[];
  pivotsFile?: string;
  k: number;
  depth: number;
  limit: number;
  direction: "forward" | "backward" | "both";
  tag?: string;
  similarityWeight: number;
  relationWeight: number;
  minCombinedScore: number;
  outputPath?: string;
}

interface ContributionEdge {
  sourceMemoId: string;
  targetMemoId: string;
  tag: string;
  weight: number;
  direction: "forward" | "backward";
  depth: number;
  reason?: string;
  path: string[];
}

interface ContributionSummary {
  memoId: string;
  title?: string;
  similarity: number;
  relationWeight: number;
  combined: number;
  bestEdge?: ContributionEdge;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    pivots: [],
    k: 6,
    depth: 2,
    limit: 80,
    direction: "both",
    similarityWeight: 0.6,
    relationWeight: 0.4,
    minCombinedScore: 0
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;

    const [flag, rawValue] = current.split("=", 2);
    const withNext = rawValue ?? argv[index + 1];
    const value = withNext ?? "";

    switch (flag) {
      case "--namespace":
        options.namespace = value;
        break;
      case "--pivot":
        options.pivots.push(value);
        break;
      case "--pivots-file":
        options.pivotsFile = value;
        break;
      case "--k":
        options.k = Number.parseInt(value, 10);
        break;
      case "--depth":
        options.depth = Number.parseInt(value, 10);
        break;
      case "--limit":
        options.limit = Number.parseInt(value, 10);
        break;
      case "--direction":
        if (value === "forward" || value === "backward" || value === "both") {
          options.direction = value;
        } else {
          throw new Error(`Unsupported --direction value: ${value}`);
        }
        break;
      case "--tag":
        options.tag = value;
        break;
      case "--similarity-weight":
        options.similarityWeight = Number.parseFloat(value);
        break;
      case "--relation-weight":
        options.relationWeight = Number.parseFloat(value);
        break;
      case "--min-combined":
        options.minCombinedScore = Number.parseFloat(value);
        break;
      case "--output":
        options.outputPath = value;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${flag}`);
    }

    if (rawValue === undefined && flag !== "--help" && flag !== "-h") {
      index += 1;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`Phase 4 automation helper\n\n` +
    `Runs the Phase 1–3 workflows for one or more pivot memos and emits consolidated reports.\n\n` +
    `Environment:\n` +
    `  MEMORY_HTTP_URL             Backend endpoint (required)\n    MEMORY_HTTP_BEARER_TOKEN    Bearer token (required)\n\n` +
    `Usage:\n` +
    `  bun run scripts/phase4Automation.ts -- --pivot <memoId> [--pivot <memoId> ...] [options]\n\n` +
    `Options:\n` +
    `  --pivots-file <path>   JSON file containing an array of memo IDs\n` +
    `  --namespace <path>     Namespace (default phase0/workspace/reasoning)\n` +
    `  --k <number>           Top results for memory.search (default 6)\n` +
    `  --depth <number>       Max depth for relation graph (default 2)\n` +
    `  --limit <number>       Edge limit for relation graph (default 80)\n` +
    `  --direction <value>    forward | backward | both (default both)\n` +
    `  --tag <name>           Optional relation tag filter\n` +
    `  --similarity-weight <f> Weight for cosine similarity (default 0.6)\n` +
    `  --relation-weight <f>  Weight for relation confidence (default 0.4)\n` +
    `  --min-combined <f>     Drop entries below threshold (default 0)\n` +
    `  --output <path>        Write JSON report to file instead of stdout\n` +
    `  -h, --help             Show this message\n`);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function computeCombinedScore(similarity: number, relation: number, similarityWeight: number, relationWeight: number): number {
  const total = similarityWeight + relationWeight;
  const denominator = total > 0 ? total : 1;
  return (
    clamp01(similarity) * similarityWeight + clamp01(relation) * relationWeight
  ) / denominator;
}

async function loadPivotList(options: CliOptions): Promise<string[]> {
  const pivots = [...options.pivots];
  if (options.pivotsFile) {
    const text = await Bun.file(options.pivotsFile).text();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      for (const value of parsed) {
        if (typeof value === "string" && value.length) {
          pivots.push(value);
        }
      }
    } else {
      throw new Error("--pivots-file must contain a JSON array of memo IDs");
    }
  }

  return Array.from(new Set(pivots));
}

function buildTitleMap(search: MemorySearchResponse, graph: RelationGraphResponse): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of search.items) {
    if (item.title) {
      map.set(item.memoId, item.title);
    }
  }
  for (const node of graph.nodes) {
    if (node.title) {
      map.set(node.memoId, node.title);
    }
  }
  return map;
}

function summarizePivot(
  pivot: string,
  namespace: string,
  search: MemorySearchResponse,
  graph: RelationGraphResponse,
  weights: { similarity: number; relation: number },
  minCombinedScore: number
): {
  pivot: string;
  namespace: string;
  searchCount: number;
  graphCount: number;
  evidence: ContributionSummary[];
  positives: ContributionSummary[];
  conflicts: ContributionSummary[];
  others: ContributionSummary[];
} {
  const titleMap = buildTitleMap(search, graph);
  const contributions = new Map<string, ContributionSummary>();

  for (const item of search.items) {
    if (item.memoId === pivot) continue;
    contributions.set(item.memoId, {
      memoId: item.memoId,
      title: item.title,
      similarity: item.score ?? 0,
      relationWeight: 0,
      combined: 0
    });
  }

  for (const edge of graph.edges) {
    const targetMemoId = edge.path.length ? edge.path[edge.path.length - 1] : edge.targetMemoId;
    if (!targetMemoId || targetMemoId === pivot) continue;

    const existing = contributions.get(targetMemoId) ?? {
      memoId: targetMemoId,
      title: titleMap.get(targetMemoId),
      similarity: 0,
      relationWeight: 0,
      combined: 0
    } satisfies ContributionSummary;

    if (edge.weight > existing.relationWeight) {
      existing.relationWeight = edge.weight;
      existing.bestEdge = {
        sourceMemoId: edge.sourceMemoId,
        targetMemoId: edge.targetMemoId,
        tag: edge.tag,
        weight: edge.weight,
        direction: edge.direction,
        depth: edge.depth,
        reason: edge.reason,
        path: edge.path
      } satisfies ContributionEdge;
    }

    contributions.set(targetMemoId, existing);
  }

  const evidence: ContributionSummary[] = [];
  for (const entry of contributions.values()) {
    entry.combined = computeCombinedScore(entry.similarity, entry.relationWeight, weights.similarity, weights.relation);
    if (entry.combined < minCombinedScore) continue;
    evidence.push(entry);
  }

  evidence.sort((a, b) => b.combined - a.combined);

  const positives = evidence.filter((entry) => {
    const tag = entry.bestEdge?.tag;
    return tag === "supports" || tag === "explains";
  });
  const conflicts = evidence.filter((entry) => entry.bestEdge?.tag === "conflicts");
  const others = evidence.filter((entry) => {
    const tag = entry.bestEdge?.tag;
    return tag !== "supports" && tag !== "explains" && tag !== "conflicts";
  });

  return {
    pivot,
    namespace,
    searchCount: search.count,
    graphCount: graph.count,
    evidence,
    positives,
    conflicts,
    others
  };
}

async function runPivot(
  bridge: MemoryHttpBridge,
  options: CliOptions,
  pivot: string,
  namespace: string
) {
  const [search, graph] = await Promise.all([
    bridge.invoke<MemorySearchResponse>("memory.search", {
      namespace,
      pivotMemoId: pivot,
      k: options.k
    }),
    bridge.invoke<RelationGraphResponse>("memory.relation.graph", {
      namespace,
      startMemoId: pivot,
      maxDepth: options.depth,
      limit: options.limit,
      direction: options.direction,
      tag: options.tag
    })
  ]);

  return summarizePivot(pivot, namespace, search, graph, {
    similarity: options.similarityWeight,
    relation: options.relationWeight
  }, options.minCombinedScore);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const namespace = args.namespace ?? "phase0/workspace/reasoning";
  const pivots = await loadPivotList(args);

  if (!pivots.length) {
    printHelp();
    throw new Error("At least one --pivot or --pivots-file entry is required");
  }

  const config = loadConfig();
  const bridge = new MemoryHttpBridge(config);

  const startedAt = new Date().toISOString();
  const reports = [];

  for (const pivot of pivots) {
    const report = await runPivot(bridge, args, pivot, namespace);
    reports.push(report);
  }

  const outcome = {
    generatedAt: startedAt,
    namespace,
    pivots,
    weights: {
      similarity: args.similarityWeight,
      relation: args.relationWeight
    },
    thresholds: {
      minCombined: args.minCombinedScore
    },
    tagFilter: args.tag ?? null,
    direction: args.direction,
    reports
  };

  const serialized = JSON.stringify(outcome, null, 2);

  if (args.outputPath) {
    await writeFile(args.outputPath, serialized, "utf8");
  } else {
    console.log(serialized);
  }
}

main().catch((error) => {
  console.error("Phase 4 automation helper failed", error);
  process.exitCode = 1;
});
