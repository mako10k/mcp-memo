import { parseEnv } from "./env";
import { createMemoryStore } from "./db";
import { generateEmbedding } from "./openai";
import {
  deleteInputSchema,
  saveInputSchema,
  searchInputSchema,
  toolInvocationSchema
} from "./schemas";

import type { EnvVars } from "./env";
import type { ToolInvocation } from "./schemas";
import type { MemoryDeleteResponse, MemorySaveResponse, MemorySearchResponse } from "@mcp/shared";

interface HandlerDependencies {
  store?: ReturnType<typeof createMemoryStore>;
  embed?: (input: string) => Promise<number[]>;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

export async function handleInvocation(
  invocation: ToolInvocation,
  envVars: EnvVars,
  dependencies: HandlerDependencies = {}
): Promise<Response> {
  const store = dependencies.store ?? createMemoryStore(envVars);
  const embed =
    dependencies.embed ?? (async (input: string) => (await generateEmbedding(envVars, input)).vector);

  switch (invocation.tool) {
    case "memory.save": {
      const parsed = saveInputSchema.parse(invocation.params ?? {});
      const metadataPatch = parsed.metadata && Object.keys(parsed.metadata).length ? parsed.metadata : undefined;

      const embeddingVector = await embed(parsed.content);
      const memo = await store.upsert({
        namespace: parsed.namespace,
        memoId: parsed.memoId,
        title: parsed.title,
        content: parsed.content,
        metadataPatch,
        embedding: embeddingVector
      });

      const payload: MemorySaveResponse = { memo };
      return jsonResponse(payload, 200);
    }
    case "memory.search": {
      const parsed = searchInputSchema.parse(invocation.params ?? {});

      const embeddingVector = parsed.query ? await embed(parsed.query) : undefined;

      const metadataFilter = parsed.metadataFilter && Object.keys(parsed.metadataFilter).length
        ? parsed.metadataFilter
        : undefined;

      const items = await store.search({
        namespace: parsed.namespace,
        embedding: embeddingVector,
        metadataFilter,
        k: parsed.k,
        minimumSimilarity: parsed.minimumSimilarity
      });

      const payload: MemorySearchResponse = {
        items,
        count: items.length
      };
      return jsonResponse(payload, 200);
    }
    case "memory.delete": {
      const parsed = deleteInputSchema.parse(invocation.params ?? {});
      const deleted = await store.delete({ namespace: parsed.namespace, memoId: parsed.memoId });
      if (!deleted) {
        return jsonResponse({ message: "Memo not found" }, 404);
      }
      const payload: MemoryDeleteResponse = { deleted: true, memo: deleted };
      return jsonResponse(payload, 200);
    }
    default:
      return jsonResponse({ message: `Unsupported tool: ${invocation.tool}` }, 400);
  }
}

export default {
  async fetch(request: Request, env: Record<string, string | undefined>): Promise<Response> {
    if (request.method !== "POST") {
      return jsonResponse({ message: "Method not allowed" }, 405);
    }

    let envVars: EnvVars;
    try {
      envVars = parseEnv(env);
    } catch (error) {
      console.error("Environment validation failed", error);
      return jsonResponse({ message: (error as Error).message }, 500);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ message: "Invalid JSON body", detail: (error as Error).message }, 400);
    }

    const result = toolInvocationSchema.safeParse(body);
    if (!result.success) {
      return jsonResponse({ message: "Invalid request payload", issues: result.error.issues }, 400);
    }

    try {
      return await handleInvocation(result.data, envVars);
    } catch (error) {
      console.error("Handler error", error);
      return jsonResponse({ message: "Internal server error", detail: (error as Error).message }, 500);
    }
  }
};
