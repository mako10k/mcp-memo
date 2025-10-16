import { describe, expect, it } from "bun:test";

import { handleInvocation, type RequestContext } from "./index";
import type { EnvVars } from "./env";
import type { MemoryStore, RelationListResult, RelationGraphResult, SearchResult } from "./db";
import type {
  MemoryEntry,
  MemoryListNamespacesResponse,
  MemoryPropertyResponse,
  MemoryListResponse,
  MemoryNamespaceRenameResponse,
  MemorySaveResponse,
  MemorySearchResponse,
  RelationListResponse,
  RelationSaveResponse,
  RelationGraphResponse,
  MemoryInferenceGuidanceResponse,
  MemoryThinkSupportOutput,
  TweetReactionOutput
} from "@mcp/shared";

const envStub: EnvVars = {
  DATABASE_URL: "postgresql://user:pass@localhost/db",
  OPENAI_API_KEY: "test-key",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
  OPENAI_RESPONSES_MODEL: "gpt-5-nano",
  OPENAI_BASE_URL: undefined,
  OPENAI_RESPONSES_BASE_URL: undefined
};

const contextStub: RequestContext = {
  ownerId: "00000000-0000-0000-0000-000000000001",
  rootNamespace: "legacy",
  defaultNamespace: "legacy/DEF"
};

const makeVector = (value: number) => Array(1536).fill(value);

const memoIdA = "00000000-0000-0000-0000-0000000000a1";
const memoIdB = "00000000-0000-0000-0000-0000000000b2";
const memoIdC = "00000000-0000-0000-0000-0000000000c3";
const missingMemoId = "00000000-0000-0000-0000-0000000000ff";

function createStoreStub(overrides: Partial<MemoryStore> = {}): MemoryStore {
  const defaultMemo: MemoryEntry = {
  memoId: memoIdA,
    namespace: "legacy/DEF/default",
    content: "Hello world",
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1
  };

  const defaultSearch: SearchResult[] = [
    {
      ...defaultMemo,
      score: 0.9
    }
  ];

  const defaultNamespaces = ["legacy/DEF", "legacy/DEF/default"];

  const defaultRelation = {
    namespace: "legacy/DEF/default",
    sourceMemoId: memoIdA,
    targetMemoId: memoIdB,
    tag: "supports",
    weight: 0.5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1
  } satisfies RelationSaveResponse["relation"];

  const defaultRelationList: RelationListResult = {
    edges: [defaultRelation],
    nodes: [
      {
        memoId: memoIdA,
        namespace: "legacy/DEF/default",
        title: "Memo A"
      },
      {
        memoId: memoIdB,
        namespace: "legacy/DEF/default",
        title: "Memo B"
      }
    ]
  };

  const defaultRelationGraph: RelationGraphResult = {
    edges: [],
    nodes: []
  };

  return {
    upsert: overrides.upsert ?? (async () => defaultMemo),
    search: overrides.search ?? (async () => defaultSearch),
    delete: overrides.delete ?? (async () => defaultMemo),
    listNamespaces: overrides.listNamespaces ?? (async () => defaultNamespaces),
    setMetadataProperty: overrides.setMetadataProperty ?? (async () => defaultMemo),
    list: overrides.list ?? (async () => ({ items: [defaultMemo], hasMore: false, nextOffset: null })),
    upsertRelation: overrides.upsertRelation ?? (async () => defaultRelation),
    deleteRelation: overrides.deleteRelation ?? (async () => defaultRelation),
    listRelations: overrides.listRelations ?? (async () => defaultRelationList),
    relationGraph: overrides.relationGraph ?? (async () => defaultRelationGraph),
    renameNamespace: overrides.renameNamespace ?? (async () => ({ memoIds: [], relationCount: 0 }))
  } satisfies MemoryStore;
}

describe("handleInvocation", () => {
  it("resolves relative namespace for memory.save", async () => {
    const response = await handleInvocation(
      { tool: "memory.save", params: { namespace: "default", content: "Hello" } },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async upsert(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.namespace).toBe("legacy/DEF/default");
            return {
              memoId: params.memoId ?? memoIdA,
              namespace: params.namespace,
              content: params.content,
              metadata: params.metadataPatch ?? {},
              title: params.title,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              version: 1
            } satisfies MemoryEntry;
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as MemorySaveResponse;
  expect(json.memo.namespace).toBe("legacy/DEF/default");
  expect(json.rootNamespace).toBe(contextStub.rootNamespace);
  });

  it("supports override default namespace from request options", async () => {
    const response = await handleInvocation(
      { tool: "memory.search", params: { namespace: "inbox", query: "Hello" } },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.02),
        store: createStoreStub({
          async search(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.namespace).toBe("legacy/projects/inbox");
            expect(params.distanceMetric).toBe("cosine");
            expect(params.pivotMemoId).toBe(undefined);
            expect(params.excludePivot).toBe(true);
            return [
              {
                memoId: memoIdB,
                namespace: params.namespace,
                content: "Hi",
                metadata: {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                version: 1,
                score: 0.8
              }
            ];
          }
        })
      },
      { defaultNamespaceOverride: "legacy/projects" }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as MemorySearchResponse;
  expect(json.items).toHaveLength(1);
  expect(json.items[0].score).toBeCloseTo(0.8);
  expect(json.items[0].namespace).toBe("legacy/projects/inbox");
  expect(json.rootNamespace).toBe(contextStub.rootNamespace);
  });

  it("searches using pivot memo embedding", async () => {
    const response = await handleInvocation(
      { tool: "memory.search", params: { namespace: "default", pivotMemoId: memoIdA, k: 5 } },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.05),
        store: createStoreStub({
          async search(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.namespace).toBe("legacy/DEF/default");
            expect(params.embedding).toBe(undefined);
            expect(params.pivotMemoId).toBe(memoIdA);
            expect(params.excludePivot).toBe(true);
            expect(params.distanceMetric).toBe("cosine");
            return [
              {
                memoId: memoIdB,
                namespace: params.namespace,
                content: "Related memo",
                metadata: {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                version: 2,
                score: 0.95
              }
            ];
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as MemorySearchResponse;
    expect(json.items).toHaveLength(1);
    expect(json.items[0].memoId).toBe(memoIdB);
    expect(json.items[0].score).toBeCloseTo(0.95);
  });

  it("rejects minimumSimilarity when using l2 metric", async () => {
    const response = await handleInvocation(
      {
        tool: "memory.search",
        params: { namespace: "default", distanceMetric: "l2", minimumSimilarity: 0.8 }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.05),
        store: createStoreStub()
      }
    );

    expect(response.status).toBe(400);
  const json = (await response.json()) as { message: string };
  expect(json.message.includes("minimumSimilarity")).toBe(true);
  });

  it("returns 404 when pivot memo is missing", async () => {
    const response = await handleInvocation(
      { tool: "memory.search", params: { namespace: "default", pivotMemoId: missingMemoId } },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async search() {
            throw new Error("PIVOT_NOT_FOUND");
          }
        })
      }
    );

    expect(response.status).toBe(404);
    const json = (await response.json()) as { message: string };
    expect(json.message).toBe("Pivot memo not found");
  });

  it("returns 404 when deleting missing memo", async () => {
    const response = await handleInvocation(
  { tool: "memory.delete", params: { namespace: "archive", memoId: missingMemoId } },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async delete(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.namespace).toBe("legacy/DEF/archive");
            return null;
          }
        })
      }
    );

  expect(response.status).toBe(404);
  });

  it("lists namespaces with depth limit", async () => {
    const response = await handleInvocation(
      { tool: "memory.list_namespaces", params: { namespace: "projects", depth: 2, limit: 50 } },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async listNamespaces(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.baseNamespace).toBe("legacy/DEF/projects");
            expect(params.depth).toBe(2);
            expect(params.limit).toBe(50);
            return [
              "legacy/DEF/projects",
              "legacy/DEF/projects/app",
              "legacy/DEF/projects/app/backend"
            ];
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as MemoryListNamespacesResponse;
    expect(json.baseNamespace).toBe("legacy/DEF/projects");
    expect(json.depth).toBe(2);
    expect(json.count).toBe(3);
    expect(json.namespaces[0]).toBe("legacy/DEF/projects");
    expect(json.namespaces[1]).toBe("legacy/DEF/projects/app");
    expect(json.namespaces[2]).toBe("legacy/DEF/projects/app/backend");
  });

  it("updates memo metadata property", async () => {
    const response = await handleInvocation(
      {
        tool: "memory.property",
        params: {
          namespace: "default",
          memoId: memoIdA,
          name: "version",
          value: "  1.2.3  "
        }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async setMetadataProperty(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.namespace).toBe("legacy/DEF/default");
            expect(params.memoId).toBe(memoIdA);
            expect(params.name).toBe("version");
            expect(params.value).toBe("  1.2.3  ");
            const normalizedValue = typeof params.value === "string" ? params.value.trim() : params.value;
            return {
              memoId: params.memoId,
              namespace: params.namespace,
              content: "memo content",
              metadata: { version: normalizedValue },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              version: 2
            } satisfies MemoryEntry;
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as MemoryPropertyResponse;
    expect(json.property.name).toBe("version");
    expect(json.property.value).toBe("1.2.3");
    expect(json.memo.metadata.version).toBe("1.2.3");
    expect(json.property.value).toBe(json.memo.metadata.version);
  });

  it("deletes memo metadata property when value is null", async () => {
    const response = await handleInvocation(
      {
        tool: "memory.property",
        params: {
          namespace: "default",
          memoId: memoIdA,
          name: "version",
          value: null
        }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async setMetadataProperty(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.namespace).toBe("legacy/DEF/default");
            expect(params.memoId).toBe(memoIdA);
            expect(params.name).toBe("version");
            expect(params.value).toBe(null);
            return {
              memoId: params.memoId,
              namespace: params.namespace,
              content: "memo content",
              metadata: {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              version: 3
            } satisfies MemoryEntry;
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as MemoryPropertyResponse;
    expect(json.property.name).toBe("version");
    expect(json.property.value).toBe(null);
    expect(json.memo.metadata.version).toBe(undefined);
    expect(Object.prototype.hasOwnProperty.call(json.memo.metadata, "version")).toBe(false);
  });

  it("deletes memo metadata property via dedicated tool", async () => {
    const response = await handleInvocation(
      {
        tool: "memory.property.delete",
        params: {
          namespace: "default",
          memoId: memoIdA,
          name: "tags"
        }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async setMetadataProperty(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.namespace).toBe("legacy/DEF/default");
            expect(params.memoId).toBe(memoIdA);
            expect(params.name).toBe("tags");
            expect(params.value).toBe(null);
            return {
              memoId: params.memoId,
              namespace: params.namespace,
              content: "memo content",
              metadata: {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              version: 3
            } satisfies MemoryEntry;
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as MemoryPropertyResponse;
    expect(json.property.name).toBe("tags");
    expect(json.property.value).toBe(null);
    expect(Object.prototype.hasOwnProperty.call(json.memo.metadata, "tags")).toBe(false);
  });

  it("lists memos with version ordering and pagination", async () => {
    const memoOne: MemoryEntry = {
      memoId: memoIdA,
      namespace: "legacy/DEF/default",
      content: "memo 1",
      metadata: { version: "1.0.0" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    };
    const memoTwo: MemoryEntry = {
      memoId: memoIdB,
      namespace: "legacy/DEF/default",
      content: "memo 2",
      metadata: { version: "1.5.0" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 2
    };
    const memoThree: MemoryEntry = {
      memoId: memoIdC,
      namespace: "legacy/DEF/default",
      content: "memo 3",
      metadata: { version: "2.0.0" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 3
    };

    const response = await handleInvocation(
      {
        tool: "memory.list",
        params: {
          namespace: "default",
          orderBy: "version",
          orderDirection: "asc",
          limit: 2,
          cursor: "2"
        }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async list(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.namespace).toBe("legacy/DEF/default");
            expect(params.orderBy).toBe("version");
            expect(params.orderDirection).toBe("asc");
            expect(params.limit).toBe(2);
            expect(params.offset).toBe(2);
            return {
              items: [memoThree],
              hasMore: false,
              nextOffset: null
            } satisfies ReturnType<MemoryStore["list"]> extends Promise<infer R> ? R : never;
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as MemoryListResponse;
    expect(json.items).toHaveLength(1);
    expect(json.items[0].memoId).toBe(memoThree.memoId);
    expect(json.count).toBe(json.items.length);
    expect(json.orderBy).toBe("version");
    expect(json.orderDirection).toBe("asc");
  expect(json.nextCursor).toBe(undefined);
  });

  it("renames namespace for a specific memo", async () => {
    const response = await handleInvocation(
      {
        tool: "memory.namespace.rename",
        params: {
          fromNamespace: "default",
          toNamespace: "projects/reports",
          memoId: memoIdA
        }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async renameNamespace(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.fromNamespace).toBe("legacy/DEF/default");
            expect(params.toNamespace).toBe("legacy/DEF/projects/reports");
            expect(params.memoId).toBe(memoIdA);
            return {
              memoIds: [memoIdA],
              relationCount: 0
            };
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as MemoryNamespaceRenameResponse;
    expect(json.previousNamespace).toBe("legacy/DEF/default");
    expect(json.newNamespace).toBe("legacy/DEF/projects/reports");
  expect(json.updatedCount).toBe(1);
  expect(json.memoIds.length).toBe(1);
  expect(json.memoIds[0]).toBe(memoIdA);
    expect(json.relationCount).toBe(0);
  });

  it("returns 404 when renaming missing memo", async () => {
    const response = await handleInvocation(
      {
        tool: "memory.namespace.rename",
        params: {
          fromNamespace: "default",
          toNamespace: "archive",
          memoId: missingMemoId
        }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async renameNamespace(params) {
            expect(params.memoId).toBe(missingMemoId);
            expect(params.fromNamespace).toBe("legacy/DEF/default");
            expect(params.toNamespace).toBe("legacy/DEF/archive");
            return {
              memoIds: [],
              relationCount: 0
            };
          }
        })
      }
    );

    expect(response.status).toBe(404);
    const json = (await response.json()) as { message: string };
    expect(json.message).toBe("Memo not found");
  });

  it("returns 409 when rename conflicts", async () => {
    const response = await handleInvocation(
      {
        tool: "memory.namespace.rename",
        params: {
          fromNamespace: "default",
          toNamespace: "archive"
        }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async renameNamespace() {
            throw new Error("NAMESPACE_RENAME_CONFLICT");
          }
        })
      }
    );

    expect(response.status).toBe(409);
    const json = (await response.json()) as { message: string };
    expect(json.message).toBe("Namespace rename conflict");
  });

  it("rejects namespace escaping root", async () => {
    const response = await handleInvocation(
      { tool: "memory.save", params: { namespace: "../../outside", content: "oops" } },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub()
      }
    );

    expect(response.status).toBe(400);
    const json = (await response.json()) as { message: string; detail?: string };
    expect(json.message).toBe("Invalid namespace");
    expect(json.detail?.includes("escaped root scope")).toBe(true);
  });

  it("rejects unsupported tool", async () => {
    const response = await handleInvocation(
      { tool: "memory.unknown" as "memory.save", params: {} },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub()
      }
    );

    expect(response.status).toBe(400);
  });

  it("returns tweet reaction", async () => {
    const reaction: TweetReactionOutput = {
      reaction: "Love the energy! Can't wait to see this bloom.",
      language: "en"
    };

    const response = await handleInvocation(
      { tool: "tweet", params: { text: "Launch day for our community garden", language: "en" } },
      envStub,
      contextStub,
      {
        tweetReact: async (input) => {
          expect(input.text.includes("community garden")).toBe(true);
          expect(input.language).toBe("en");
          return reaction;
        }
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as TweetReactionOutput;
    expect(json.reaction).toBe(reaction.reaction);
    expect(json.language).toBe("en");
  });

  it("saves memory relation", async () => {
    const response = await handleInvocation(
      {
        tool: "memory.relation.save",
        params: {
          namespace: "default",
          sourceMemoId: memoIdA,
          targetMemoId: memoIdB,
          tag: "supports",
          weight: 0.9,
          reason: "Memo A supports memo B"
        }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async upsertRelation(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.namespace).toBe("legacy/DEF/default");
            expect(params.tag).toBe("supports");
            expect(params.weight).toBeCloseTo(0.9);
            expect(params.reason).toBe("Memo A supports memo B");
            return {
              namespace: params.namespace,
              sourceMemoId: params.sourceMemoId,
              targetMemoId: params.targetMemoId,
              tag: params.tag,
              weight: params.weight,
              reason: params.reason,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              version: 1
            } satisfies RelationSaveResponse["relation"]; 
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as RelationSaveResponse;
    expect(json.relation.namespace).toBe("legacy/DEF/default");
    expect(json.rootNamespace).toBe(contextStub.rootNamespace);
  });

  it("deletes missing relation with 404", async () => {
    const response = await handleInvocation(
      {
        tool: "memory.relation.delete",
        params: {
          namespace: "default",
          sourceMemoId: memoIdA,
          targetMemoId: memoIdB,
          tag: "supports"
        }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async deleteRelation() {
            return null;
          }
        })
      }
    );

    expect(response.status).toBe(404);
    const json = (await response.json()) as { message: string };
    expect(json.message).toBe("Relation not found");
  });

  it("lists relations", async () => {
    const response = await handleInvocation(
      {
        tool: "memory.relation.list",
        params: {
          namespace: "default",
          sourceMemoId: memoIdA,
          limit: 50
        }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async listRelations(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.namespace).toBe("legacy/DEF/default");
            expect(params.sourceMemoId).toBe(memoIdA);
            return {
              edges: [
                {
                  namespace: "legacy/DEF/default",
                  sourceMemoId: memoIdA,
                  targetMemoId: memoIdB,
                  tag: "supports",
                  weight: 0.7,
                  reason: "Memo A supports B",
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  version: 2
                }
              ],
              nodes: [
                {
                  memoId: memoIdA,
                  namespace: "legacy/DEF/default",
                  title: "Memo A"
                },
                {
                  memoId: memoIdB,
                  namespace: "legacy/DEF/default",
                  title: "Memo B"
                }
              ]
            } satisfies RelationListResult;
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as RelationListResponse;
    expect(json.namespace).toBe("legacy/DEF/default");
    expect(json.count).toBe(1);
    expect(json.edges[0].tag).toBe("supports");
    expect(json.nodes).toHaveLength(2);
  });

  it("traverses relation graph with directional control", async () => {
    const response = await handleInvocation(
      {
        tool: "memory.relation.graph",
        params: {
          namespace: "default",
          startMemoId: memoIdA,
          maxDepth: 2,
          direction: "both",
          limit: 10
        }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async relationGraph(params) {
            expect(params.ownerId).toBe(contextStub.ownerId);
            expect(params.namespace).toBe("legacy/DEF/default");
            expect(params.startMemoId).toBe(memoIdA);
            expect(params.direction).toBe("both");
            expect(params.maxDepth).toBe(2);
            expect(params.limit).toBe(10);
            return {
              edges: [
                {
                  namespace: "legacy/DEF/default",
                  sourceMemoId: memoIdA,
                  targetMemoId: memoIdB,
                  tag: "supports",
                  weight: 0.6,
                  reason: "Memo A supports B",
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  version: 1,
                  depth: 1,
                  direction: "forward",
                  path: [memoIdA, memoIdB]
                },
                {
                  namespace: "legacy/DEF/default",
                  sourceMemoId: memoIdB,
                  targetMemoId: memoIdC,
                  tag: "related",
                  weight: 0.4,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  version: 1,
                  depth: 2,
                  direction: "forward",
                  path: [memoIdA, memoIdB, memoIdC]
                }
              ],
              nodes: [
                {
                  memoId: memoIdA,
                  namespace: "legacy/DEF/default",
                  title: "Memo A"
                },
                {
                  memoId: memoIdB,
                  namespace: "legacy/DEF/default",
                  title: "Memo B"
                },
                {
                  memoId: memoIdC,
                  namespace: "legacy/DEF/default",
                  title: "Memo C"
                }
              ]
            } satisfies RelationGraphResult;
          }
        })
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as RelationGraphResponse;
    expect(json.namespace).toBe("legacy/DEF/default");
    expect(json.count).toBe(2);
    expect(json.edges[0].depth).toBe(1);
  expect(json.edges[1].path.length).toBe(3);
  expect(json.edges[1].path[0]).toBe(memoIdA);
  expect(json.edges[1].path[2]).toBe(memoIdC);
    expect(json.nodes).toHaveLength(3);
  });

  it("returns inference guidance summary", async () => {
    const response = await handleInvocation(
      { tool: "memory.inference.guidance", params: {} },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub()
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as MemoryInferenceGuidanceResponse;
    expect(json.language).toBe("en");
    expect(json.summary.includes("memory.* tool set")).toBe(true);
    expect(json.phases.length >= 4).toBe(true);
    expect(json.phases[0].id).toBe("phase0");
    expect(json.references.docs).toHaveLength(0);
    expect(json.references.scripts).toHaveLength(0);
  });

  it("delegates memory.think.support to provided runner", async () => {
    const runnerResponse: MemoryThinkSupportOutput = {
      phase: "divergence",
      ideas: [
        {
          id: "idea-1",
          title: "Idea one",
          summary: "First idea summary",
          inspirationSource: "benchmark",
          riskNotes: ["Needs validation"],
          metadata: { category: "campaign" }
        }
      ],
      coverage: "Explored onboarding challenges; mobile remains open",
      nextRecommendation: "move to clustering",
      warnings: ["Review technical feasibility"]
    };

    const response = await handleInvocation(
      {
        tool: "memory.think.support",
        params: {
          phase: "divergence",
          topic: "Improve activation",
          constraints: ["Launch within 4 weeks"],
          seedAngles: ["Community-driven"],
          ideas: [
            {
              id: "seed-1",
              title: "Starter",
              summary: "Existing idea",
              metadata: { origin: "user" }
            }
          ]
        }
      },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub(),
        thinkSupport: async (input) => {
          expect(input.phase).toBe("divergence");
          expect(input.topic).toBe("Improve activation");
          expect(input.seedAngles?.length).toBe(1);
          expect(input.seedAngles?.[0]).toBe("Community-driven");
          return runnerResponse;
        }
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as MemoryThinkSupportOutput;
    expect(json.phase).toBe("divergence");
    if (json.phase === "divergence") {
      expect(json.ideas).toHaveLength(1);
    }
    expect(json.nextRecommendation).toBe("move to clustering");
  });

  it("ignores requested non-english language", async () => {
    const response = await handleInvocation(
      { tool: "memory.inference.guidance", params: { language: "ja" } },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub()
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as MemoryInferenceGuidanceResponse;
    expect(json.language).toBe("en");
    expect(json.summary.includes("memory.* tool set")).toBe(true);
  });

  it("returns empty payload for think tool", async () => {
    const response = await handleInvocation(
      { tool: "think" as const, params: { topic: "Reflection", depth: 3 } },
      envStub,
      contextStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub()
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(json).length).toBe(0);
  });
});
