import process from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  deleteInputSchema,
  listNamespacesInputSchema,
  relationDeleteInputSchema,
  relationListInputSchema,
  relationSaveInputSchema,
  relationGraphInputSchema,
  inferenceGuidanceInputSchema,
  memoryThinkSupportInputSchema,
  saveInputSchema,
  searchInputSchema,
  type DeleteInput,
  type ListNamespacesInput,
  type RelationGraphInput,
  type MemoryDeleteResponse,
  type MemoryListNamespacesResponse,
  type MemoryEntry,
  type MemorySaveResponse,
  type MemorySearchResponse,
  type RelationDeleteResponse,
  type RelationListResponse,
  type RelationSaveResponse,
  type RelationEntry,
  type RelationNode,
  type RelationSaveInput,
  type RelationDeleteInput,
  type RelationListInput,
  type RelationGraphResponse,
  type RelationGraphEdge,
  type SaveInput,
  type SearchInput,
  type InferenceGuidanceInput,
  type MemoryInferenceGuidanceResponse,
  type MemoryThinkSupportInput,
  type MemoryThinkSupportOutput,
  thinkInputSchema,
  type ThinkInput
} from "./memorySchemas";
import { loadConfig } from "./config";
import { MemoryHttpBridge } from "./httpBridge";

const serverInfo = {
  name: "memory-mcp",
  version: "0.4.0"
};

type CliArgKey =
  | "memory-http-url"
  | "memory-http-bearer-token"
  | "memory-http-headers"
  | "memory-http-timeout-ms";

const cliArgToEnv: Record<CliArgKey, keyof NodeJS.ProcessEnv> = {
  "memory-http-url": "MEMORY_HTTP_URL",
  "memory-http-bearer-token": "MEMORY_HTTP_BEARER_TOKEN",
  "memory-http-headers": "MEMORY_HTTP_HEADERS",
  "memory-http-timeout-ms": "MEMORY_HTTP_TIMEOUT_MS"
};

function showHelp(): void {
  const lines = [
    "Usage: memory-mcp [options]",
    "",
    "Options:",
    "  --memory-http-url <url>            HTTP endpoint for the memory worker",
    "  --memory-http-bearer-token <token> Optional bearer token",
    "  --memory-http-headers <json>       Additional headers as JSON string",
    "  --memory-http-timeout-ms <ms>      HTTP timeout in milliseconds",
    "  -h, --help                         Show this message"
  ];
  console.log(lines.join("\n"));
}

function parseCliArgs(argv: string[]): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current?.startsWith("--")) continue;

    if (current === "--help" || current === "-h") {
      showHelp();
      process.exit(0);
    }

    const [flag, rawValue] = current.split("=", 2);
    const key = flag.slice(2) as CliArgKey;
    if (!(key in cliArgToEnv)) {
      console.warn(`Unknown option: ${flag}`);
      continue;
    }

    let value = rawValue;
    if (value === undefined) {
      value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`Option ${flag} requires a value`);
      }
      index += 1;
    }

    overrides[cliArgToEnv[key]] = value;
  }
  return overrides;
}

function stripRootNamespace(namespace: string, rootHint?: string): string {
  const segments = namespace.split("/").filter((segment) => segment.length > 0);
  if (!segments.length) return "";

  if (rootHint) {
    const rootSegments = rootHint.split("/").filter((segment) => segment.length > 0);
    const matchesRoot = rootSegments.every((segment, index) => segments[index] === segment);
    if (matchesRoot && segments.length >= rootSegments.length) {
      const trimmed = segments.slice(rootSegments.length).join("/");
      return trimmed;
    }
  }

  const trimmed = segments.slice(1).join("/");
  return trimmed;
}

function memoToPayload(memo: MemoryEntry, rootHint?: string, score?: number | null) {
  return {
    id: memo.memoId,
    namespace: stripRootNamespace(memo.namespace, rootHint),
    createdAt: memo.createdAt,
    updatedAt: memo.updatedAt,
    version: memo.version,
    ...(typeof score === "number" ? { score } : {})
  };
}

function relationToPayload(relation: RelationEntry, rootHint?: string) {
  return {
    namespace: stripRootNamespace(relation.namespace, rootHint),
    sourceMemoId: relation.sourceMemoId,
    targetMemoId: relation.targetMemoId,
    tag: relation.tag,
    weight: relation.weight,
    reason: relation.reason,
    createdAt: relation.createdAt,
    updatedAt: relation.updatedAt,
    version: relation.version
  };
}

function nodeToPayload(node: RelationNode, rootHint?: string) {
  return {
    memoId: node.memoId,
    namespace: stripRootNamespace(node.namespace, rootHint),
    title: node.title
  };
}

function graphEdgeToPayload(edge: RelationGraphEdge, rootHint?: string) {
  return {
    ...relationToPayload(edge, rootHint),
    depth: edge.depth,
    direction: edge.direction,
    path: edge.path
  };
}

function thinkSupportToPayload(output: MemoryThinkSupportOutput) {
  return {
    phase: output.phase,
    details: output
  };
}

async function registerTools(bridge: MemoryHttpBridge, server: McpServer): Promise<void> {
  server.registerTool("memory-save", {
    title: "Save memory entry",
    description: "Save a memo into the specified namespace. Omit memoId when creating a memo (it will be generated automatically). Provide an existing memoId only when overwriting a memo.",
    inputSchema: saveInputSchema.shape
  }, async (args: unknown) => {
    const parsed = saveInputSchema.parse(args) as SaveInput;
    const result = await bridge.invoke<MemorySaveResponse>("memory.save", parsed);
    const payload = {
      status: "ok",
      memo: memoToPayload(result.memo, result.rootNamespace)
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload)
        }
      ]
    };
  });

  server.registerTool("memory-search", {
    title: "Search memory entries",
  description: "Search for memos within the specified namespace. Supports full-text and metadata filters.",
    inputSchema: searchInputSchema.shape
  }, async (args: unknown) => {
    const parsed = searchInputSchema.parse(args) as SearchInput;
    const result = await bridge.invoke<MemorySearchResponse>("memory.search", parsed);
    const payload = {
      status: "ok",
      count: result.count,
      items: result.items.map((item) => memoToPayload(item, result.rootNamespace, item.score ?? undefined))
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload)
        }
      ]
    };
  });

  server.registerTool("memory-delete", {
    title: "Delete memory entry",
  description: "Delete a memo from the specified namespace.",
    inputSchema: deleteInputSchema.shape
  }, async (args: unknown) => {
    const parsed = deleteInputSchema.parse(args) as DeleteInput;
    const result = await bridge.invoke<MemoryDeleteResponse>("memory.delete", parsed);
    const payload = {
      status: "ok",
      deleted: result.deleted,
      memo: result.memo ? memoToPayload(result.memo, result.rootNamespace) : undefined
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload)
        }
      ]
    };
  });

  server.registerTool("memory-list-namespaces", {
    title: "List child namespaces",
  description: "List child namespaces relative to the current base namespace.",
    inputSchema: listNamespacesInputSchema.shape
  }, async (args: unknown) => {
    const parsed = listNamespacesInputSchema.parse(args) as ListNamespacesInput;
    const result = await bridge.invoke<MemoryListNamespacesResponse>("memory.list_namespaces", parsed);
    const payload = {
      status: "ok",
      baseNamespace: stripRootNamespace(result.baseNamespace, result.rootNamespace),
      depth: result.depth,
      count: result.count,
      namespaces: result.namespaces.map((ns) => stripRootNamespace(ns, result.rootNamespace))
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload)
        }
      ]
    };
  });

  server.registerTool(
    "memory-relation-save",
    {
      title: "Save memory relation",
      description: "Create or update a semantic relation between two memos.",
      inputSchema: relationSaveInputSchema.shape
    },
    async (args: unknown) => {
      const parsed = relationSaveInputSchema.parse(args) as RelationSaveInput;
      const result = await bridge.invoke<RelationSaveResponse>("memory.relation.save", parsed);
      const payload = {
        status: "ok",
        relation: relationToPayload(result.relation, result.rootNamespace)
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload)
          }
        ]
      };
    }
  );

  server.registerTool(
    "memory-relation-delete",
    {
      title: "Delete memory relation",
      description: "Delete an existing relation between two memos.",
      inputSchema: relationDeleteInputSchema.shape
    },
    async (args: unknown) => {
      const parsed = relationDeleteInputSchema.parse(args) as RelationDeleteInput;
      const result = await bridge.invoke<RelationDeleteResponse>("memory.relation.delete", parsed);
      const payload = {
        status: "ok",
        deleted: result.deleted,
        relation: result.relation ? relationToPayload(result.relation, result.rootNamespace) : undefined
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload)
          }
        ]
      };
    }
  );

  server.registerTool(
    "memory-relation-list",
    {
      title: "List memory relations",
      description: "List relations matching filters for a namespace.",
      inputSchema: relationListInputSchema.shape
    },
    async (args: unknown) => {
      const parsed = relationListInputSchema.parse(args) as RelationListInput;
      const result = await bridge.invoke<RelationListResponse>("memory.relation.list", parsed);
      const payload = {
        status: "ok",
        namespace: stripRootNamespace(result.namespace, result.rootNamespace),
        count: result.count,
        edges: result.edges.map((edge) => relationToPayload(edge, result.rootNamespace)),
        nodes: result.nodes.map((node) => nodeToPayload(node, result.rootNamespace))
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload)
          }
        ]
      };
    }
  );

  server.registerTool(
    "memory-relation-graph",
    {
      title: "Traverse memory relation graph",
      description: "Perform a bounded-depth traversal over memo relations with directional control.",
      inputSchema: relationGraphInputSchema.shape
    },
    async (args: unknown) => {
      const parsed = relationGraphInputSchema.parse(args) as RelationGraphInput;
      const result = await bridge.invoke<RelationGraphResponse>("memory.relation.graph", parsed);
      const payload = {
        status: "ok",
        namespace: stripRootNamespace(result.namespace, result.rootNamespace),
        count: result.count,
        edges: result.edges.map((edge) => graphEdgeToPayload(edge, result.rootNamespace)),
        nodes: result.nodes.map((node) => nodeToPayload(node, result.rootNamespace))
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload)
          }
        ]
      };
    }
  );

  server.registerTool(
    "memory-inference-guidance",
    {
      title: "Explain inference workflow",
      description: "Summarize the Phase 0-4 inference workflow, scripts, and documentation references.",
      inputSchema: inferenceGuidanceInputSchema.shape
    },
    async (args: unknown) => {
      const parsed = inferenceGuidanceInputSchema.parse(args ?? {}) as InferenceGuidanceInput;
      const result = await bridge.invoke<MemoryInferenceGuidanceResponse>("memory.inference.guidance", parsed);
      const payload = {
        status: "ok",
        guidance: result
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload)
          }
        ]
      };
    }
  );

  server.registerTool(
    "memory-think-support",
    {
      title: "Facilitate brainstorming phases",
      description: "Guide divergent, clustering, and convergent brainstorming with structured outputs.",
      inputSchema: memoryThinkSupportInputSchema.shape
    },
    async (args: unknown) => {
      const parsed = memoryThinkSupportInputSchema.parse(args ?? {}) as MemoryThinkSupportInput;
      const result = await bridge.invoke<MemoryThinkSupportOutput>("memory.think.support", parsed);
      const payload = {
        status: "ok",
        support: thinkSupportToPayload(result)
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload)
          }
        ]
      };
    }
  );

  const thinkTool = server.registerTool(
    "think",
    {
      title: "Pause to reflect",
      description: "Use this when you want the assistant to pause and reflect"
    },
    async (args: unknown) => {
      const parsed = thinkInputSchema.parse(args ?? {});
      await bridge.invoke("think", parsed);
      return { content: [] };
    }
  ) as unknown as { inputSchema?: typeof thinkInputSchema };
  thinkTool.inputSchema = thinkInputSchema;
}

async function main(): Promise<void> {
  const overrides = parseCliArgs(process.argv.slice(2));
  const config = loadConfig({ ...process.env, ...overrides });
  const bridge = new MemoryHttpBridge(config);

  const server = new McpServer(serverInfo, {
    capabilities: {
      tools: {}
    },
    instructions:
      "Use memory-save / memory-search / memory-delete / memory-list-namespaces for memo operations and memory-relation-save / memory-relation-delete / memory-relation-list / memory-relation-graph to manage and traverse semantic links. Call memory-inference-guidance for the Phase 0-4 workflow overview, memory-think-support to run divergent/clustering/convergent brainstorming with gpt-5-nano, and think when you want the assistant to pause and reflect without changing state. Configure the HTTP backend URL and headers via environment variables."
  });

  await registerTools(bridge, server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("memory-mcp server failed", error);
  process.exitCode = 1;
});
