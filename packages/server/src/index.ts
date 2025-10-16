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
  inferenceGuidanceInputSchema,
  saveInputSchema,
  searchInputSchema,
  memoryThinkSupportInputSchema,
  thinkInputSchema,
  toolInvocationSchema
} from "./schemas";
import { createApiKeyStore } from "./auth.js";
import { resolveNamespace, type NamespaceResolution } from "./namespace.js";

import type { EnvVars } from "./env";
import type {
  MemoryThinkSupportInput,
  MemoryThinkSupportOutput,
  ToolInvocation
} from "./schemas";
import type {
  MemoryDeleteResponse,
  MemoryListNamespacesResponse,
  MemorySaveResponse,
  MemorySearchResponse,
  RelationDeleteResponse,
  RelationListResponse,
  RelationSaveResponse,
  RelationGraphResponse,
  MemoryInferenceGuidanceResponse
} from "@mcp/shared";
import type { ApiKeyContext } from "./auth.js";
import { createThinkSupportRunner } from "./thinkSupport";

interface HandlerDependencies {
  store?: ReturnType<typeof createMemoryStore>;
  embed?: (input: string) => Promise<number[]>;
  thinkSupport?: (input: MemoryThinkSupportInput) => Promise<MemoryThinkSupportOutput>;
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
  const thinkSupport = dependencies.thinkSupport ?? createThinkSupportRunner(envVars);

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
    case "memory.inference.guidance": {
      const parsed = inferenceGuidanceInputSchema.parse(invocation.params ?? {});
      const language = parsed.language === "ja" ? "ja" : "en";
      const payload = buildInferenceGuidance(language);
      return jsonResponse(payload, 200);
    }
    case "memory.think.support": {
      const parsed = memoryThinkSupportInputSchema.parse(invocation.params ?? {});
      const result = await thinkSupport(parsed);
      return jsonResponse(result, 200);
    }
    case "think": {
      thinkInputSchema.parse(invocation.params ?? {});
      return jsonResponse({}, 200);
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

const BASE_PREREQUISITES = [
  "Configure MEMORY_HTTP_URL and authentication headers in the MCP client or scripts.",
  "Confirm access to the namespace phase0/workspace/reasoning.",
  "Install Bun and run bun install at repository root."
] as const;

const BASE_PHASES = [
  {
    id: "phase0",
    title: "Phase 0 — Seed Review",
    objective:
      "Map out the namespaces and confirm the seeded memo graph before starting any reasoning task.",
    documentation:
      "1. Invoke memory-list-namespaces with {\"tool\":\"memory.list_namespaces\",\"params\":{\"namespace\":\"phase0\",\"depth\":3,\"limit\":50}} to enumerate accessible namespaces. 2. For each namespace you plan to use, call memory-search with {\"tool\":\"memory.search\",\"params\":{\"namespace\":\"phase0/workspace/reasoning\",\"k\":5}} to read the seeded memos and tags. 3. If you need the relation layout, call memory-relation-graph with {\"tool\":\"memory.relation.graph\",\"params\":{\"namespace\":\"phase0/workspace/reasoning\",\"startMemoId\":<pivot>,\"direction\":\"both\",\"maxDepth\":2}}.",
    recommendedTools: ["memory-list-namespaces", "memory-search", "memory-relation-graph"],
    scripts: [],
    outputs: [
      "Namespace inventory with default scope confirmed.",
      "Baseline understanding of existing memos and relations."
    ],
    nextSteps: [
      "Choose one or more pivot memos for further investigation.",
      "Capture any gaps that require new memos via memory-save."
    ]
  },
  {
    id: "phase1",
    title: "Phase 1 — Pivot Retrieval",
    objective:
      "Gather candidate evidence around a pivot memo using semantic similarity and relation traversal.",
    documentation:
      "1. Call memory-search with {\"tool\":\"memory.search\",\"params\":{\"namespace\":\"phase0/workspace/reasoning\",\"pivotMemoId\":<pivotId>,\"k\":8}} to retrieve semantic neighbors while excluding the pivot. 2. Immediately follow with memory-relation-graph using {\"tool\":\"memory.relation.graph\",\"params\":{\"namespace\":\"phase0/workspace/reasoning\",\"startMemoId\":<pivotId>,\"direction\":\"both\",\"maxDepth\":2,\"limit\":80}} to inspect linked memos and relation tags.",
    recommendedTools: ["memory-search", "memory-relation-graph"],
    scripts: [],
    outputs: [
      "Top-k semantic matches for the pivot memo.",
      "Graph paths that explain how related memos connect."
    ],
    nextSteps: [
      "Compile the retrieved memos into a working set for scoring.",
      "Note which relation tags imply support versus conflict."
    ]
  },
  {
    id: "phase2",
    title: "Phase 2 — Evidence Scoring",
    objective:
      "Prioritize candidate memos by combining similarity scores with relation weights and tags.",
    documentation:
      "For every memo surfaced in Phase 1, call memory-relation-list with {\"tool\":\"memory.relation.list\",\"params\":{\"namespace\":\"phase0/workspace/reasoning\",\"targetMemoId\":<candidateId>,\"limit\":50}} to collect relation weights and tags. Combine those weights with the similarity score returned from memory-search to compute a final ranking inside the LLM.",
    recommendedTools: ["memory-search", "memory-relation-list"],
    scripts: [],
    outputs: [
      "Ranked evidence table with combined confidence per memo.",
      "Breakout of supporting, neutral, and conflicting relations."
    ],
    nextSteps: [
      "Summarize high-value evidence into a structured report.",
      "Prepare feedback prompts for relation adjustments if conflicts appear."
    ]
  },
  {
    id: "phase3",
    title: "Phase 3 — Feedback Application",
    objective:
      "Apply structured updates to the relation graph based on evidence review or LLM critique.",
    documentation:
      "When the analysis suggests an update, call memory-relation-save with {\"tool\":\"memory.relation.save\",\"params\":{\"namespace\":\"phase0/workspace/reasoning\",\"sourceMemoId\":<sourceId>,\"targetMemoId\":<targetId>,\"tag\":<tag>,\"weight\":<0-1>,\"reason\":<text>}}. Remove invalid edges via memory-relation-delete using matching identifiers. Verify the new structure with memory-relation-graph before proceeding.",
    recommendedTools: ["memory-relation-save", "memory-relation-delete", "memory-relation-graph"],
    scripts: [],
    outputs: [
      "List of relation changes applied during the session.",
      "Updated graph snapshot showing resolved conflicts."
    ],
    nextSteps: [
      "Loop back to Phase 1 or 2 if major changes impact search context.",
      "Log unresolved questions for human reviewers."
    ]
  },
  {
    id: "phase4",
    title: "Phase 4 — Automation Sweep",
    objective:
      "Repeat the earlier phases across multiple pivots to monitor coverage and surface drift over time.",
    documentation:
      "Build a list of pivot memo IDs and iterate through it. For each pivot, repeat the Phase 1 and Phase 2 calls (memory-search with pivotMemoId and memory-relation-graph) and capture the evidence summaries. Aggregate the per-pivot results into a JSON report that downstream agents can consume without additional tooling.",
    recommendedTools: ["memory-search", "memory-relation-graph"],
    scripts: [],
    outputs: [
      "Per-pivot evidence digests and key relation changes.",
      "Checklist of follow-up actions generated from conflicts or missing data."
    ],
    nextSteps: [
      "Schedule periodic sweeps or trigger them when large updates land.",
      "Share summaries with stakeholders or other MCP agents."
    ]
  }
] satisfies MemoryInferenceGuidanceResponse["phases"];

const BASE_AUTOMATION_NOTE =
  "Use memory-search and memory-relation-graph on a schedule to refresh inference coverage for critical pivots.";

const BASE_MAINTENANCE = [
  "Add new memos and relations when product or research updates arrive.",
  "Audit relation weights monthly to keep scoring trustworthy.",
  "Version control feedback prompts alongside the docs to ensure reproducibility."
] as const;

const GUIDANCE_EN: Omit<MemoryInferenceGuidanceResponse, "language"> = {
  summary:
    "Use the memory.* tool set to walk through seed review, pivot retrieval, evidence scoring, feedback updates, and automation sweeps without relying on external documentation.",
  prerequisites: [...BASE_PREREQUISITES],
  phases: BASE_PHASES,
  followUp: {
    automation: BASE_AUTOMATION_NOTE,
    maintenance: [...BASE_MAINTENANCE]
  },
  references: {
    docs: [],
    scripts: []
  }
};

function buildInferenceGuidance(_language: "en" | "ja"): MemoryInferenceGuidanceResponse {
  return { ...GUIDANCE_EN, language: "en" };
}
