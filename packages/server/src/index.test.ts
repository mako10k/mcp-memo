import { describe, expect, it } from "bun:test";

import { handleInvocation } from "./index";
import type { EnvVars } from "./env";
import type { MemoryStore, SearchResult } from "./db";
import type { MemoryEntry } from "@mcp/shared";

const envStub: EnvVars = {
  DATABASE_URL: "postgresql://user:pass@localhost/db",
  OPENAI_API_KEY: "test-key",
  OPENAI_EMBEDDING_MODEL: "text-embedding-3-small"
};

const makeVector = (value: number) => Array(1536).fill(value);

function createStoreStub(overrides: Partial<MemoryStore> = {}): MemoryStore {
  const defaultMemo: MemoryEntry = {
    memoId: "memo-1",
    namespace: "default",
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
  it("returns memo after memory.save", async () => {
    const response = await handleInvocation(
      { tool: "memory.save", params: { namespace: "default", content: "Hello" } },
      envStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub()
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as { memo: MemoryEntry };
    expect(json.memo.namespace).toBe("default");
  });

  it("returns results for memory.search", async () => {
    const response = await handleInvocation(
      { tool: "memory.search", params: { namespace: "default", query: "Hello" } },
      envStub,
      {
        embed: async () => makeVector(0.02),
        store: createStoreStub({
          async search() {
            return [
              {
                memoId: "memo-2",
                namespace: "default",
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
      }
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as { items: SearchResult[] };
    expect(json.items).toHaveLength(1);
    expect(json.items[0].score).toBeCloseTo(0.8);
  });

  it("returns 404 when deleting missing memo", async () => {
    const response = await handleInvocation(
      { tool: "memory.delete", params: { namespace: "default", memoId: "missing" } },
      envStub,
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub({
          async delete() {
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
      {
        embed: async () => makeVector(0.01),
        store: createStoreStub()
      }
    );

    expect(response.status).toBe(400);
  });
});
