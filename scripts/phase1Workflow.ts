#!/usr/bin/env bun
import process from "node:process";

import type { MemorySearchResponse, RelationGraphResponse } from "@mcp/shared";
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
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    k: 5,
    depth: 2,
    limit: 50,
    direction: "both"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;

    const [flag, rawValue] = current.split("=", 2);
    const nextValue = rawValue ?? argv[index + 1];
    const value = nextValue ?? "";

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
  console.log(`Phase 1 inference workflow helper\n\n` +
    `Environment:\n` +
    `  MEMORY_HTTP_URL             Backend endpoint (required)\n` +
    `  MEMORY_HTTP_BEARER_TOKEN    Bearer token (required)\n` +
    `  MEMORY_NAMESPACE_DEFAULT    Optional default namespace\n\n` +
    `Usage:\n` +
    `  bun run scripts/phase1Workflow.ts -- --pivot <memoId> [options]\n\n` +
    `Options:\n` +
    `  --namespace <path>      Namespace to query (default phase0/workspace/reasoning)\n` +
    `  --k <number>            Top results for memory.search (default 5)\n` +
    `  --depth <number>        Max depth for relation graph (default 2)\n` +
    `  --limit <number>        Edge limit for relation graph (default 50)\n` +
    `  --direction <value>     forward | backward | both (default both)\n` +
    `  --tag <name>            Optional relation tag filter\n` +
    `  -h, --help              Show this message\n`);
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

  const searchPayload = {
    namespace,
    pivotMemoId: args.pivot,
    k: args.k
  };

  const relationGraphPayload = {
    namespace,
    startMemoId: args.pivot,
    maxDepth: args.depth,
    limit: args.limit,
    direction: args.direction,
    tag: args.tag
  };

  const [searchResult, graphResult] = await Promise.all([
    bridge.invoke<MemorySearchResponse>("memory.search", searchPayload),
    bridge.invoke<RelationGraphResponse>("memory.relation.graph", relationGraphPayload)
  ]);

  const summary = {
    pivot: args.pivot,
    namespace,
    search: {
      count: searchResult.count,
      memoIds: searchResult.items.map((item) => ({
        memoId: item.memoId,
        title: item.title,
        score: item.score
      }))
    },
    graph: {
      count: graphResult.count,
      edges: graphResult.edges.map((edge) => ({
        sourceMemoId: edge.sourceMemoId,
        targetMemoId: edge.targetMemoId,
        tag: edge.tag,
        weight: edge.weight,
        direction: edge.direction,
        depth: edge.depth,
        path: edge.path
      })),
      nodes: graphResult.nodes.map((node) => ({
        memoId: node.memoId,
        title: node.title
      }))
    }
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("Phase 1 workflow failed", error);
  process.exitCode = 1;
});
