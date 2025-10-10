import process from "node:process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  deleteInputSchema,
  saveInputSchema,
  searchInputSchema,
  type DeleteInput,
  type MemoryDeleteResponse,
  type MemoryEntry,
  type MemorySaveResponse,
  type MemorySearchResponse,
  type MemoMetadata,
  type SaveInput,
  type SearchInput
} from "@mcp/shared";
import { loadConfig } from "./config";
import { MemoryHttpBridge } from "./httpBridge";

const serverInfo = {
  name: "memory-mcp",
  version: "0.1.0"
};

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
    description: "指定した namespace にメモを保存します。既存IDを指定すると上書きします。",
    inputSchema: saveInputSchema.shape
  }, async (args: unknown) => {
    const parsed = saveInputSchema.parse(args) as SaveInput;
    const result = await bridge.invoke<MemorySaveResponse>("memory.save", parsed);
    return {
      content: [
        {
          type: "text",
          text: [
            "✅ メモを保存しました",
            formatMemo(result.memo)
          ].join("\n\n")
        }
      ]
    };
  });

  server.registerTool("memory-search", {
    title: "Search memory entries",
    description: "指定した namespace でメモを検索します。全文検索とメタデータ検索に対応します。",
    inputSchema: searchInputSchema.shape
  }, async (args: unknown) => {
    const parsed = searchInputSchema.parse(args) as SearchInput;
    const result = await bridge.invoke<MemorySearchResponse>("memory.search", parsed);

    const lines = result.items.length
      ? result.items.map((item, index) => `#${index + 1}\n${formatMemo(item, item.score)}`).join("\n\n")
      : "該当するメモは見つかりませんでした";

    return {
      content: [
        {
          type: "text",
          text: [
            `🔍 メモを検索しました (件数: ${result.count})`,
            lines
          ].join("\n\n")
        }
      ]
    };
  });

  server.registerTool("memory-delete", {
    title: "Delete memory entry",
    description: "指定した namespace からメモを削除します。",
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
                "🗑️ メモを削除しました",
                result.memo ? formatMemo(result.memo) : undefined
              ]
                .filter(Boolean)
                .join("\n\n")
            : "指定されたメモは見つかりませんでした"
        }
      ]
    };
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const bridge = new MemoryHttpBridge(config);

  const server = new McpServer(serverInfo, {
    capabilities: {
      tools: {}
    },
    instructions:
      "memory-save / memory-search / memory-delete ツールでメモの保存・検索・削除ができます。環境変数でHTTPバックエンドのURLやヘッダーを設定してください。"
  });

  await registerTools(bridge, server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("memory-mcp server failed", error);
  process.exitCode = 1;
});
