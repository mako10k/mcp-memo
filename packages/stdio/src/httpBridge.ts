import { type MemoryBridgeConfig } from "./config";
import type { ToolInvocation } from "./memorySchemas";

export class MemoryHttpBridge {
  constructor(private readonly config: MemoryBridgeConfig) {}

  async invoke<TResponse>(tool: ToolInvocation["tool"], params: unknown): Promise<TResponse> {
    const controller = this.config.timeoutMs ? new AbortController() : undefined;

    const timeout = this.config.timeoutMs
      ? setTimeout(() => controller?.abort(), this.config.timeoutMs)
      : undefined;

    try {
      const response = await fetch(this.config.baseUrl, {
        method: "POST",
        headers: this.config.headers,
        body: JSON.stringify({ tool, params }),
        signal: controller?.signal
      });

      const text = await response.text();
      let json: unknown;
      try {
        json = text.length ? JSON.parse(text) : {};
      } catch (error) {
        throw new Error(`バックエンドからのJSON解析に失敗しました: ${(error as Error).message}\n${text}`);
      }

      if (!response.ok) {
        const message = typeof json === "object" && json && "message" in json ? (json as Record<string, unknown>).message : undefined;
        const fallback = message ?? (text || "Unknown error");
        throw new Error(`バックエンドがエラーを返しました (status=${response.status}): ${fallback}`);
      }

      return json as TResponse;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error("バックエンドへのリクエストがタイムアウトしました");
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
