#!/usr/bin/env bun
import process from "node:process";

import type { MemorySearchResponse, RelationGraphResponse } from "../packages/shared/src/index";
import { MemoryHttpBridge } from "../packages/stdio/src/httpBridge";
import { loadConfig } from "../packages/stdio/src/config";

interface CliOptions {
  namespace?: string;
  pivot?: string;
  k: number;
  depth: number;
  limit: number;
  direction: "forward" | "backward" | "both";
  tag?: string;
  similarityWeight: number;
  relationWeight: number;
  minCombinedScore: number;
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
  pathTitles: string;
}

interface Contribution {
  memoId: string;
  title?: string;
  similarity: number;
  relationWeight: number;
  bestEdge?: ContributionEdge;
  combined: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    k: 5,
    depth: 2,
    limit: 50,
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
        options.pivot = value;
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
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${flag}`);
    }

    if (rawValue === undefined) {
      index += 1;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`Phase 2 scoring helper\n\n` +
    `Environment:\n` +
    `  MEMORY_HTTP_URL             Backend endpoint (required)\n` +
    `  MEMORY_HTTP_BEARER_TOKEN    Bearer token (required)\n` +
    `  MEMORY_NAMESPACE_DEFAULT    Optional default namespace\n\n` +
    `Usage:\n` +
    `  bun run scripts/phase2Scoring.ts -- --pivot <memoId> [options]\n\n` +
    `Options:\n` +
    `  --namespace <path>      Namespace to query (default phase0/workspace/reasoning)\n` +
    `  --k <number>            Top results for memory.search (default 5)\n` +
    `  --depth <number>        Max depth for relation graph (default 2)\n` +
    `  --limit <number>        Edge limit for relation graph (default 50)\n` +
    `  --direction <value>     forward | backward | both (default both)\n` +
    `  --tag <name>            Optional relation tag filter\n` +
    `  --similarity-weight <f> Weight for cosine similarity (default 0.6)\n` +
    `  --relation-weight <f>   Weight for relation confidence (default 0.4)\n` +
    `  --min-combined <f>      Drop entries below combined score threshold\n` +
    `  -h, --help              Show this message\n`);
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

function formatPathTitles(path: string[], titleMap: Map<string, string>): string {
  return path.map((memoId) => titleMap.get(memoId) ?? memoId).join(" -> ");
}

function upsertContribution(
  contributions: Map<string, Contribution>,
  memoId: string,
  update: Partial<Contribution>
): Contribution {
  const current = contributions.get(memoId) ?? {
    memoId,
    title: update.title,
    similarity: 0,
    relationWeight: 0,
    combined: 0
  } satisfies Contribution;

  if (typeof update.title === "string" && update.title.length) {
    current.title = update.title;
  }
  if (typeof update.similarity === "number" && !Number.isNaN(update.similarity)) {
    current.similarity = update.similarity;
  }
  if (typeof update.relationWeight === "number" && update.relationWeight > current.relationWeight) {
    current.relationWeight = update.relationWeight;
  }
  if (update.bestEdge && (!current.bestEdge || update.bestEdge.weight > current.bestEdge.weight)) {
    current.bestEdge = update.bestEdge;
  }

  contributions.set(memoId, current);
  return current;
}

function computeCombinedScores(
  contributions: Map<string, Contribution>,
  similarityWeight: number,
  relationWeight: number
): Contribution[] {
  const totalWeight = similarityWeight + relationWeight;
  const denominator = totalWeight > 0 ? totalWeight : 1;

  const results: Contribution[] = [];
  for (const contribution of contributions.values()) {
    const similarity = clamp01(contribution.similarity);
    const relation = clamp01(contribution.relationWeight);
    contribution.combined = (
      similarity * similarityWeight + relation * relationWeight
    ) / denominator;
    results.push(contribution);
  }
  return results;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.pivot) {
    printHelp();
    throw new Error("--pivot is required");
  }

  const namespace = args.namespace ?? "phase0/workspace/reasoning";

  const config = loadConfig();
  const bridge = new MemoryHttpBridge(config);

  const [searchResult, graphResult] = await Promise.all([
    bridge.invoke<MemorySearchResponse>("memory.search", {
      namespace,
      pivotMemoId: args.pivot,
      k: args.k
    }),
    bridge.invoke<RelationGraphResponse>("memory.relation.graph", {
      namespace,
      startMemoId: args.pivot,
      maxDepth: args.depth,
      limit: args.limit,
      direction: args.direction,
      tag: args.tag
    })
  ]);

  const titleMap = buildTitleMap(searchResult, graphResult);
  const contributions = new Map<string, Contribution>();

  for (const item of searchResult.items) {
    if (item.memoId === args.pivot) continue;
    upsertContribution(contributions, item.memoId, {
      title: item.title,
      similarity: item.score ?? 0
    });
  }

  for (const edge of graphResult.edges) {
    const targetMemoId = edge.path.length ? edge.path[edge.path.length - 1] : edge.targetMemoId;
    if (!targetMemoId || targetMemoId === args.pivot) continue;

    const edgePayload: ContributionEdge = {
      sourceMemoId: edge.sourceMemoId,
      targetMemoId: edge.targetMemoId,
      tag: edge.tag,
      weight: edge.weight,
      direction: edge.direction,
      depth: edge.depth,
      reason: edge.reason,
      path: edge.path,
      pathTitles: formatPathTitles(edge.path, titleMap)
    };

    upsertContribution(contributions, targetMemoId, {
      title: titleMap.get(targetMemoId),
      relationWeight: edge.weight,
      bestEdge: edgePayload
    });
  }

  const combined = computeCombinedScores(contributions, args.similarityWeight, args.relationWeight)
    .filter((entry) => entry.memoId !== args.pivot)
    .filter((entry) => entry.combined >= args.minCombinedScore)
    .sort((a, b) => b.combined - a.combined);

  const positives = combined.filter((entry) => {
    const tag = entry.bestEdge?.tag;
    return tag === "supports" || tag === "explains";
  });

  const conflicts = combined.filter((entry) => entry.bestEdge?.tag === "conflicts");

  const other = combined.filter((entry) => {
    const tag = entry.bestEdge?.tag;
    return tag !== "supports" && tag !== "explains" && tag !== "conflicts";
  });

  const response = {
    pivot: args.pivot,
    namespace,
    weights: {
      similarity: args.similarityWeight,
      relation: args.relationWeight
    },
    thresholds: {
      minCombined: args.minCombinedScore
    },
    prioritizedEvidence: positives,
    conflictingEvidence: conflicts,
    otherRelations: other,
    raw: {
      searchCount: searchResult.count,
      graphCount: graphResult.count
    }
  };

  console.log(JSON.stringify(response, null, 2));
}

main().catch((error) => {
  console.error("Phase 2 scoring helper failed", error);
  process.exitCode = 1;
});
