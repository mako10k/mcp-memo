declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  export type ToolCallback = (args: unknown, extra: unknown) => Promise<unknown> | unknown;
  export class McpServer {
    constructor(serverInfo: unknown, options?: unknown);
    connect(transport: unknown): Promise<void>;
    registerTool(name: string, config: Record<string, unknown>, callback: ToolCallback): void;
  }
}

declare module "@modelcontextprotocol/sdk/server/stdio.js" {
  export class StdioServerTransport {
    constructor(stdin?: unknown, stdout?: unknown);
    start(): Promise<void>;
  }
}
