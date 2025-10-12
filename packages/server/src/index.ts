import { parseEnv } from "./env";
import { createMemoryStore } from "./db";
import { generateEmbedding } from "./openai";
import {
  deleteInputSchema,
  listNamespacesInputSchema,
  relationDeleteInputSchema,
  relationGraphInputSchema,
  relationListInputSchema,
  relationSaveInputSchema,
  saveInputSchema,
  searchInputSchema,
  toolInvocationSchema
} from "./schemas";
import { createApiKeyStore } from "./auth.js";
import { resolveNamespace, type NamespaceResolution } from "./namespace.js";

import type { EnvVars } from "./env";
import type { ToolInvocation } from "./schemas";
import type {
  MemoryDeleteResponse,
  MemoryListNamespacesResponse,
  MemorySaveResponse,
  MemorySearchResponse,
  RelationDeleteResponse,
  RelationListResponse,
  RelationSaveResponse,
  RelationGraphResponse
} from "@mcp/shared";
import type { ApiKeyContext } from "./auth.js";

interface HandlerDependencies {
  store?: ReturnType<typeof createMemoryStore>;
  embed?: (input: string) => Promise<number[]>;
}

export interface RequestContext extends ApiKeyContext {}

export interface InvocationOptions {
  defaultNamespaceOverride?: string;
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
  context: RequestContext,
  dependencies: HandlerDependencies = {},
  options: InvocationOptions = {}
): Promise<Response> {
  const store = dependencies.store ?? createMemoryStore(envVars);
  const embed =
    dependencies.embed ?? (async (input: string) => (await generateEmbedding(envVars, input)).vector);

  switch (invocation.tool) {
    case "memory.save": {
      const parsed = saveInputSchema.parse(invocation.params ?? {});
      let resolved: NamespaceResolution;
      try {
        resolved = resolveNamespace(context, {
          namespace: parsed.namespace,
          defaultOverride: options.defaultNamespaceOverride
        });
      } catch (error) {
        return jsonResponse(
          { message: "Invalid namespace", detail: (error as Error).message },
          400
        );
      }
      const metadataPatch = parsed.metadata && Object.keys(parsed.metadata).length ? parsed.metadata : undefined;

      const embeddingVector = await embed(parsed.content);
      const memo = await store.upsert({
        ownerId: context.ownerId,
        namespace: resolved.namespace,
        memoId: parsed.memoId,
        title: parsed.title,
        content: parsed.content,
        metadataPatch,
        embedding: embeddingVector
      });

  const payload: MemorySaveResponse = { memo, rootNamespace: context.rootNamespace };
      return jsonResponse(payload, 200);
    }
    case "memory.search": {
      const parsed = searchInputSchema.parse(invocation.params ?? {});
      let resolved: NamespaceResolution;
      try {
        resolved = resolveNamespace(context, {
          namespace: parsed.namespace,
          defaultOverride: options.defaultNamespaceOverride
        });
      } catch (error) {
        return jsonResponse(
          { message: "Invalid namespace", detail: (error as Error).message },
          400
        );
      }

      if (parsed.distanceMetric === "l2" && typeof parsed.minimumSimilarity === "number") {
        return jsonResponse(
          { message: "minimumSimilarity is only supported with cosine distance" },
          400
        );
      }

      const usingPivot = Boolean(parsed.pivotMemoId);
      const shouldEmbedQuery = Boolean(parsed.query) && !usingPivot;
      const embeddingVector = shouldEmbedQuery ? await embed(parsed.query!) : undefined;

      const metadataFilter = parsed.metadataFilter && Object.keys(parsed.metadataFilter).length
        ? parsed.metadataFilter
        : undefined;

      try {
        const items = await store.search({
          ownerId: context.ownerId,
          namespace: resolved.namespace,
          embedding: embeddingVector,
          metadataFilter,
          k: parsed.k,
          minimumSimilarity: parsed.distanceMetric === "cosine" ? parsed.minimumSimilarity : undefined,
          pivotMemoId: parsed.pivotMemoId,
          distanceMetric: parsed.distanceMetric,
          excludePivot: parsed.excludePivot ?? true
        });

        const payload: MemorySearchResponse = {
          items,
          count: items.length,
          rootNamespace: context.rootNamespace
        };
        return jsonResponse(payload, 200);
      } catch (error) {
        if ((error as Error).message === "PIVOT_NOT_FOUND") {
          return jsonResponse({ message: "Pivot memo not found" }, 404);
        }
        throw error;
      }
    }
    case "memory.delete": {
      const parsed = deleteInputSchema.parse(invocation.params ?? {});
      let resolved: NamespaceResolution;
      try {
        resolved = resolveNamespace(context, {
          namespace: parsed.namespace,
          defaultOverride: options.defaultNamespaceOverride
        });
      } catch (error) {
        return jsonResponse(
          { message: "Invalid namespace", detail: (error as Error).message },
          400
        );
      }
  const deleted = await store.delete({ ownerId: context.ownerId, namespace: resolved.namespace, memoId: parsed.memoId });
      if (!deleted) {
        return jsonResponse({ message: "Memo not found" }, 404);
      }
  const payload: MemoryDeleteResponse = { deleted: true, memo: deleted, rootNamespace: context.rootNamespace };
      return jsonResponse(payload, 200);
    }
    case "memory.list_namespaces": {
      const parsed = listNamespacesInputSchema.parse(invocation.params ?? {});
      let resolved: NamespaceResolution;
      try {
        resolved = resolveNamespace(context, {
          namespace: parsed.namespace,
          defaultOverride: options.defaultNamespaceOverride
        });
      } catch (error) {
        return jsonResponse(
          { message: "Invalid namespace", detail: (error as Error).message },
          400
        );
      }

      const namespaces = await store.listNamespaces({
        ownerId: context.ownerId,
        baseNamespace: resolved.namespace,
        depth: parsed.depth,
        limit: parsed.limit
      });

      const payload: MemoryListNamespacesResponse = {
        baseNamespace: resolved.namespace,
        defaultNamespace: resolved.defaultNamespace,
        rootNamespace: context.rootNamespace,
        depth: parsed.depth,
        count: namespaces.length,
        namespaces
      };

      return jsonResponse(payload, 200);
    }
    case "memory.relation.save": {
      const parsed = relationSaveInputSchema.parse(invocation.params ?? {});
      let resolved: NamespaceResolution;
      try {
        resolved = resolveNamespace(context, {
          namespace: parsed.namespace,
          defaultOverride: options.defaultNamespaceOverride
        });
      } catch (error) {
        return jsonResponse(
          { message: "Invalid namespace", detail: (error as Error).message },
          400
        );
      }

      const relation = await store.upsertRelation({
        ownerId: context.ownerId,
        namespace: resolved.namespace,
        sourceMemoId: parsed.sourceMemoId,
        targetMemoId: parsed.targetMemoId,
        tag: parsed.tag,
        weight: parsed.weight,
        reason: parsed.reason
      });

      const payload: RelationSaveResponse = {
        relation,
        rootNamespace: context.rootNamespace
      };
      return jsonResponse(payload, 200);
    }
    case "memory.relation.delete": {
      const parsed = relationDeleteInputSchema.parse(invocation.params ?? {});
      let resolved: NamespaceResolution;
      try {
        resolved = resolveNamespace(context, {
          namespace: parsed.namespace,
          defaultOverride: options.defaultNamespaceOverride
        });
      } catch (error) {
        return jsonResponse(
          { message: "Invalid namespace", detail: (error as Error).message },
          400
        );
      }

      const relation = await store.deleteRelation({
        ownerId: context.ownerId,
        namespace: resolved.namespace,
        sourceMemoId: parsed.sourceMemoId,
        targetMemoId: parsed.targetMemoId,
        tag: parsed.tag
      });

      if (!relation) {
        return jsonResponse({ message: "Relation not found" }, 404);
      }

      const payload: RelationDeleteResponse = {
        deleted: true,
        relation,
        rootNamespace: context.rootNamespace
      };
      return jsonResponse(payload, 200);
    }
    case "memory.relation.list": {
      const parsed = relationListInputSchema.parse(invocation.params ?? {});
      let resolved: NamespaceResolution;
      try {
        resolved = resolveNamespace(context, {
          namespace: parsed.namespace,
          defaultOverride: options.defaultNamespaceOverride
        });
      } catch (error) {
        return jsonResponse(
          { message: "Invalid namespace", detail: (error as Error).message },
          400
        );
      }

      const result = await store.listRelations({
        ownerId: context.ownerId,
        namespace: resolved.namespace,
        sourceMemoId: parsed.sourceMemoId,
        targetMemoId: parsed.targetMemoId,
        tag: parsed.tag,
        limit: parsed.limit
      });

      const payload: RelationListResponse = {
        namespace: resolved.namespace,
        rootNamespace: context.rootNamespace,
        count: result.edges.length,
        edges: result.edges,
        nodes: result.nodes
      };

      return jsonResponse(payload, 200);
    }
    case "memory.relation.graph": {
      const parsed = relationGraphInputSchema.parse(invocation.params ?? {});
      let resolved: NamespaceResolution;
      try {
        resolved = resolveNamespace(context, {
          namespace: parsed.namespace,
          defaultOverride: options.defaultNamespaceOverride
        });
      } catch (error) {
        return jsonResponse(
          { message: "Invalid namespace", detail: (error as Error).message },
          400
        );
      }

      const result = await store.relationGraph({
        ownerId: context.ownerId,
        namespace: resolved.namespace,
        startMemoId: parsed.startMemoId,
        maxDepth: parsed.maxDepth,
        direction: parsed.direction,
        tag: parsed.tag,
        limit: parsed.limit
      });

      const payload: RelationGraphResponse = {
        namespace: resolved.namespace,
        rootNamespace: context.rootNamespace,
        count: result.edges.length,
        edges: result.edges,
        nodes: result.nodes
      };

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

    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return jsonResponse({ message: "Unauthorized" }, 401);
    }

    const authStore = createApiKeyStore(envVars);
    const context = await authStore.findByToken(apiKey);
    if (!context) {
      return jsonResponse({ message: "Unauthorized" }, 401);
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

    const defaultNamespaceOverride = extractNamespaceOverride(request);

    try {
      return await handleInvocation(result.data, envVars, context, {}, { defaultNamespaceOverride });
    } catch (error) {
      console.error("Handler error", error);
      return jsonResponse({ message: "Internal server error", detail: (error as Error).message }, 500);
    }
  }
};

function extractApiKey(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  const apiKey = request.headers.get("x-api-key");
  return apiKey ? apiKey.trim() : null;
}

function extractNamespaceOverride(request: Request): string | undefined {
  const override = request.headers.get("x-namespace-default");
  if (!override) return undefined;
  const trimmed = override.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
