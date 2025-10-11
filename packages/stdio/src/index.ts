import process from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  deleteInputSchema,
  listNamespacesInputSchema,
  saveInputSchema,
  searchInputSchema,
  type DeleteInput,
  type ListNamespacesInput,
  type MemoryDeleteResponse,
  type MemoryListNamespacesResponse,
  type MemoryEntry,
  type MemorySaveResponse,
  type MemorySearchResponse,
  type MemoMetadata,
  type SaveInput,
  type SearchInput
} from "./memorySchemas";
import { loadConfig } from "./config";
import { MemoryHttpBridge } from "./httpBridge";

const serverInfo = {
  name: "memory-mcp",
  version: "0.1.3"
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

function formatMetadata(metadata: MemoMetadata | undefined): string {
  if (!metadata) return "{}";
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return String(metadata);
  }
}

function formatMemo(memo: MemoryEntry, score?: number | null): string {
  const header = memo.title ? `${memo.title} (${memo.memoId})` : memo.memoId;
  const scoreLabel = typeof score === "number" ? ` score=${score.toFixed(3)}` : score ? ` score=${score}` : "";
  const metadata = formatMetadata(memo.metadata);
  return [
    `${header}${scoreLabel}`.trim(),
    `Namespace: ${memo.namespace}`,
    `Content: ${memo.content}`,
    `Metadata: ${metadata}`,
    `Updated: ${memo.updatedAt}`
  ]
    .filter(Boolean)
    .join("\n");
}

async function registerTools(bridge: MemoryHttpBridge, server: McpServer): Promise<void> {
  server.registerTool("memory-save", {
    title: "Save memory entry",
    description: "Save a memo into the specified namespace. Omit memoId when creating a memo (it will be generated automatically). Provide an existing memoId only when overwriting a memo.",
    inputSchema: saveInputSchema.shape
  }, async (args: unknown) => {
    const parsed = saveInputSchema.parse(args) as SaveInput;
    const result = await bridge.invoke<MemorySaveResponse>("memory.save", parsed);
    return {
      content: [
        {
          type: "text",
          text: [
            "✅ Saved memo",
            formatMemo(result.memo)
          ].join("\n\n")
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

    const lines = result.items.length
      ? result.items.map((item, index) => `#${index + 1}\n${formatMemo(item, item.score)}`).join("\n\n")
  : "No matching memos were found.";

    return {
      content: [
        {
          type: "text",
          text: [
            `🔍 Search completed (count: ${result.count})`,
            lines
          ].join("\n\n")
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

    return {
      content: [
        {
          type: "text",
          text: result.deleted
            ? [
                "🗑️ Deleted memo",
                result.memo ? formatMemo(result.memo) : undefined
              ]
                .filter(Boolean)
                .join("\n\n")
            : "The requested memo was not found."
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

    const lines = result.namespaces.length
      ? result.namespaces.map((ns) => `- ${ns}`).join("\n")
  : "No namespaces were found.";

    return {
      content: [
        {
          type: "text",
          text: [
            "📁 Namespace listing",
            `Base: ${result.baseNamespace} (depth=${result.depth})`,
            lines
          ].join("\n\n")
        }
      ]
    };
  });
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
      "Use memory-save / memory-search / memory-delete / memory-list-namespaces to store, search, delete, and list namespaces. Configure the HTTP backend URL and headers via environment variables."
  });

  await registerTools(bridge, server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("memory-mcp server failed", error);
  process.exitCode = 1;
});
