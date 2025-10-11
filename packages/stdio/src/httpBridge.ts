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
        const payload = (typeof json === "object" && json) ? (json as Record<string, unknown>) : undefined;
        const message = payload && typeof payload.message === "string" ? payload.message : undefined;
        const detailLines: string[] = [];

        if (payload) {
          if (typeof payload.detail === "string" && payload.detail.trim().length) {
            detailLines.push(payload.detail.trim());
          }

          if (Array.isArray(payload.issues) && payload.issues.length) {
            const serialized = JSON.stringify(payload.issues, null, 2);
            detailLines.push(`issues: ${serialized}`);
          }
        }

        if (!message && detailLines.length === 0 && text) {
          detailLines.push(text);
        }

        const detailSection = detailLines.length ? `\n詳細:\n${detailLines.join("\n")}` : "";
        const fallback = message ?? (text || "Unknown error");
        throw new Error(`バックエンドがエラーを返しました (status=${response.status}): ${fallback}${detailSection}`.trim());
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
