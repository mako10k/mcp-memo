import { describe, expect, it } from "bun:test";

import { handleInvocation, type RequestContext } from "./index";
import type { EnvVars } from "./env";
import type { MemoryStore, SearchResult } from "./db";
import type { MemoryEntry, MemoryListNamespacesResponse } from "@mcp/shared";

const envStub: EnvVars = {
  DATABASE_URL: "postgresql://user:pass@localhost/db",
  OPENAI_API_KEY: "test-key",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small"
};

const contextStub: RequestContext = {
  ownerId: "00000000-0000-0000-0000-000000000001",
  rootNamespace: "legacy",
  defaultNamespace: "legacy/DEF"
};

const makeVector = (value: number) => Array(1536).fill(value);

const memoIdA = "00000000-0000-0000-0000-0000000000a1";
const memoIdB = "00000000-0000-0000-0000-0000000000b2";
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

  return {
    upsert: overrides.upsert ?? (async () => defaultMemo),
    search: overrides.search ?? (async () => defaultSearch),
    delete: overrides.delete ?? (async () => defaultMemo),
    listNamespaces: overrides.listNamespaces ?? (async () => defaultNamespaces)
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
    const json = (await response.json()) as { memo: MemoryEntry };
    expect(json.memo.namespace).toBe("legacy/DEF/default");
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
    const json = (await response.json()) as { items: SearchResult[] };
    expect(json.items).toHaveLength(1);
    expect(json.items[0].score).toBeCloseTo(0.8);
    expect(json.items[0].namespace).toBe("legacy/projects/inbox");
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
});
