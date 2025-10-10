import { describe, expect, it } from "bun:test";

import { handleInvocation, type RequestContext } from "./index";
import type { EnvVars } from "./env";
import type { MemoryStore, SearchResult } from "./db";
import type { MemoryEntry } from "@mcp/shared";

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

function createStoreStub(overrides: Partial<MemoryStore> = {}): MemoryStore {
  const defaultMemo: MemoryEntry = {
    memoId: "memo-1",
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

  return {
    upsert: overrides.upsert ?? (async () => defaultMemo),
    search: overrides.search ?? (async () => defaultSearch),
    delete: overrides.delete ?? (async () => defaultMemo)
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
              memoId: params.memoId ?? "memo-1",
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
                memoId: "memo-2",
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
      { tool: "memory.delete", params: { namespace: "archive", memoId: "missing" } },
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
