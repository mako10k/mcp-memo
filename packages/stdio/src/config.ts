import { z } from "zod";

const defaultBaseUrl = "http://127.0.0.1:8787";

const headersSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string())
  .refine((value) => {
    if (!value) return true;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }, "MEMORY_HTTP_HEADERS must be valid JSON object");

const configSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .catch(defaultBaseUrl)
    .transform((value) => value.replace(/\/$/, "")),
  bearerToken: z.string().min(1).optional(),
  headers: headersSchema.optional(),
  namespaceDefault: z.string().min(1).optional(),
  timeoutMs: z
    .coerce.number()
    .int()
    .positive()
    .optional()
});

export interface MemoryBridgeConfig {
  baseUrl: string;
  headers: Record<string, string>;
  namespaceDefault?: string;
  timeoutMs?: number;
}

interface RawEnv {
  [key: string]: string | undefined;
}

export function loadConfig(env: RawEnv = process.env): MemoryBridgeConfig {
  const parsed = configSchema.parse({
    baseUrl: env.MEMORY_HTTP_URL ?? defaultBaseUrl,
    bearerToken: env.MEMORY_HTTP_BEARER_TOKEN,
    headers: env.MEMORY_HTTP_HEADERS,
    namespaceDefault: env.MEMORY_NAMESPACE_DEFAULT,
    timeoutMs: env.MEMORY_HTTP_TIMEOUT_MS
  });

  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (parsed.headers) {
    const trimmed = parsed.headers.trim();
    if (trimmed) {
      Object.assign(headers, JSON.parse(trimmed));
    }
  }

  if (parsed.bearerToken) {
    headers.Authorization = `Bearer ${parsed.bearerToken}`;
  }

  if (parsed.namespaceDefault) {
    headers["x-namespace-default"] = parsed.namespaceDefault;
  }

  return {
    baseUrl: parsed.baseUrl,
    headers,
    namespaceDefault: parsed.namespaceDefault,
    timeoutMs: parsed.timeoutMs
  };
}
