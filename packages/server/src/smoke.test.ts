import { describe, expect, it } from "bun:test";

import { handleInvocation, type RequestContext } from "./index";
import type { EnvVars } from "./env";
import type {
  MemoryStore,
  RelationListResult,
  RelationGraphResult,
  SearchResult,
  NamespaceRenameResult,
  MemoryListResult,
  MetadataPropertyMutationResult
} from "./db";
import type {
  MemoryEntry,
  MemorySaveResponse,
  MemorySearchResponse,
  MemoryDeleteResponse,
  MemoryListNamespacesResponse,
  MemoryPropertyResponse,
  MemoryPropertyListResponse,
  MemoryListResponse,
  MemoryNamespaceRenameResponse,
  RelationSaveResponse,
  RelationListResponse,
  RelationEntry
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
  ownerId: "00000000-0000-0000-0000-0000000000ab",
  rootNamespace: "workspace",
  defaultNamespace: "workspace/inbox"
};

const makeVector = (value: number) => Array(1536).fill(value);

interface StoredRelationKey {
  namespace: string;
  sourceMemoId: string;
  targetMemoId: string;
  tag: string;
}

function relationKey(params: StoredRelationKey): string {
  return `${params.namespace}:${params.sourceMemoId}:${params.targetMemoId}:${params.tag}`;
}

class InMemoryStore implements MemoryStore {
  private memoSequence = 0;
  private memos = new Map<string, MemoryEntry>();
  private relations = new Map<string, RelationEntry>();

  private versionSegments(value: unknown): number[] {
    if (typeof value !== "string" || value.trim() === "") {
      return [0];
    }

    const segments = value
      .split(".")
      .map((part) => Number.parseInt(part.replace(/[^0-9]/g, ""), 10))
      .filter((num) => Number.isFinite(num));

    return segments.length ? segments : [0];
  }

  async upsert(params: Parameters<MemoryStore["upsert"]>[0]): Promise<MemoryEntry> {
    const memoId = params.memoId ?? this.generateMemoId();
    const now = new Date().toISOString();
    const existing = this.memos.get(memoId);

    const mergedMetadata = existing
      ? { ...existing.metadata, ...(params.metadataPatch ?? {}) }
      : params.metadataPatch ?? {};

    const entry: MemoryEntry = {
      memoId,
      namespace: params.namespace,
      title: params.title ?? existing?.title,
      content: params.content,
      metadata: mergedMetadata,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: existing ? existing.version + 1 : 1
    };

    this.memos.set(memoId, entry);
    return entry;
  }

  async search(params: Parameters<MemoryStore["search"]>[0]): Promise<SearchResult[]> {
    const matches = Array.from(this.memos.values()).filter(
      (memo) => memo.namespace === params.namespace && memo.memoId !== params.pivotMemoId
    );

    const limit = Math.max(1, params.k);
    const trimmed = matches.slice(0, limit);

    return trimmed.map((memo) => ({ ...memo, score: 0.5 } satisfies SearchResult));
  }

  async delete(params: Parameters<MemoryStore["delete"]>[0]): Promise<MemoryEntry | null> {
    const memo = this.memos.get(params.memoId);
    if (!memo || memo.namespace !== params.namespace) {
      return null;
    }

    this.memos.delete(params.memoId);

    for (const key of Array.from(this.relations.keys())) {
      const relation = this.relations.get(key);
      if (
        relation &&
        (relation.sourceMemoId === params.memoId || relation.targetMemoId === params.memoId)
      ) {
        this.relations.delete(key);
      }
    }

    return memo;
  }

  async setMetadataProperty(
    params: Parameters<MemoryStore["setMetadataProperty"]>[0]
  ): Promise<MetadataPropertyMutationResult> {
    const memo = this.memos.get(params.memoId);
    if (!memo || memo.namespace !== params.namespace) {
      return {
        memo: null,
        previousValue: undefined,
        currentValue: undefined,
        previousExists: false,
        currentExists: false
      } satisfies MetadataPropertyMutationResult;
    }

    const metadata = { ...memo.metadata } as Record<string, unknown>;
    const previousExists = Object.prototype.hasOwnProperty.call(metadata, params.name);
    const previousValue = previousExists ? metadata[params.name] : undefined;

    if (params.value === null) {
      delete metadata[params.name];
    } else {
      metadata[params.name] = params.value;
    }

    const currentExists = params.value !== null;
    const currentValue = params.value === null ? undefined : params.value;

    const updated: MemoryEntry = {
      ...memo,
      metadata,
      updatedAt: new Date().toISOString(),
      version: memo.version + 1
    };

    this.memos.set(params.memoId, updated);
    return {
      memo: updated,
      previousValue,
      currentValue,
      previousExists,
      currentExists
    } satisfies MetadataPropertyMutationResult;
  }

  async getMetadataProperties(
    params: Parameters<MemoryStore["getMetadataProperties"]>[0]
  ): Promise<MemoryEntry | null> {
    const memo = this.memos.get(params.memoId);
    if (!memo || memo.namespace !== params.namespace) {
      return null;
    }
    return memo;
  }

  async list(params: Parameters<MemoryStore["list"]>[0]): Promise<MemoryListResult> {
    const entries = Array.from(this.memos.values()).filter(
      (memo) => memo.namespace === params.namespace
    );

    const direction = params.orderDirection === "asc" ? 1 : -1;

    const sorted = entries.sort((a, b) => {
      if (params.orderBy) {
        const aSegments = this.versionSegments(a.metadata[params.orderBy]);
        const bSegments = this.versionSegments(b.metadata[params.orderBy]);
        const length = Math.max(aSegments.length, bSegments.length);
        for (let index = 0; index < length; index += 1) {
          const aValue = aSegments[index] ?? 0;
          const bValue = bSegments[index] ?? 0;
          if (aValue !== bValue) {
            return (aValue - bValue) * direction;
          }
        }
        return (a.version - b.version) * direction;
      }

      const timeDiff = (a.updatedAt > b.updatedAt ? 1 : a.updatedAt < b.updatedAt ? -1 : 0) * direction;
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return (a.version - b.version) * direction;
    });

    const offset = Math.max(0, params.offset);
    const limit = Math.max(1, Math.min(params.limit, 100));
    const slice = sorted.slice(offset, offset + limit);
    const hasMore = offset + slice.length < sorted.length;

    return {
      items: slice,
      hasMore,
      nextOffset: hasMore ? offset + slice.length : null
    } satisfies MemoryListResult;
  }

  async listNamespaces(params: Parameters<MemoryStore["listNamespaces"]>[0]): Promise<string[]> {
    const base = params.baseNamespace;
    const baseSegments = base.split("/");
    const depthLimit = baseSegments.length + Math.max(1, params.depth);

    const namespaces = new Set<string>([base]);
    for (const memo of this.memos.values()) {
      if (memo.namespace === base || memo.namespace.startsWith(`${base}/`)) {
        const segments = memo.namespace.split("/");
        const truncated = segments.slice(0, Math.min(segments.length, depthLimit));
        namespaces.add(truncated.join("/"));
      }
    }

    return Array.from(namespaces).sort();
  }

  async upsertRelation(params: Parameters<MemoryStore["upsertRelation"]>[0]): Promise<RelationEntry> {
    const now = new Date().toISOString();
    const key = relationKey(params);
    const existing = this.relations.get(key);

    const entry: RelationEntry = {
      namespace: params.namespace,
      sourceMemoId: params.sourceMemoId,
      targetMemoId: params.targetMemoId,
      tag: params.tag,
      weight: params.weight,
      reason: params.reason,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: existing ? existing.version + 1 : 1
    };

    this.relations.set(key, entry);
    return entry;
  }

  async deleteRelation(params: Parameters<MemoryStore["deleteRelation"]>[0]): Promise<RelationEntry | null> {
    const key = relationKey(params);
    const existing = this.relations.get(key) ?? null;
    if (existing) {
      this.relations.delete(key);
    }
    return existing;
  }

  async listRelations(params: Parameters<MemoryStore["listRelations"]>[0]): Promise<RelationListResult> {
    const edges = Array.from(this.relations.values()).filter((relation) => {
      if (relation.namespace !== params.namespace) return false;
      if (params.sourceMemoId && relation.sourceMemoId !== params.sourceMemoId) return false;
      if (params.targetMemoId && relation.targetMemoId !== params.targetMemoId) return false;
      if (params.tag && relation.tag !== params.tag) return false;
      return true;
    });

    const limited = edges.slice(0, params.limit);
    const memoIds = new Set<string>();
    for (const edge of limited) {
      memoIds.add(edge.sourceMemoId);
      memoIds.add(edge.targetMemoId);
    }

    const nodes = Array.from(memoIds).map((memoId) => {
      const memo = this.memos.get(memoId);
      return {
        memoId,
        namespace: memo?.namespace ?? params.namespace,
        title: memo?.title
      };
    });

    return {
      edges: limited,
      nodes
    } satisfies RelationListResult;
  }

  async relationGraph(): Promise<RelationGraphResult> {
    return { edges: [], nodes: [] } satisfies RelationGraphResult;
  }

  async renameNamespace(params: Parameters<MemoryStore["renameNamespace"]>[0]): Promise<NamespaceRenameResult> {
    if (params.fromNamespace === params.toNamespace) {
      return { memoIds: [], relationCount: 0 } satisfies NamespaceRenameResult;
    }

    if (params.memoId) {
      const memo = this.memos.get(params.memoId);
      if (!memo || memo.namespace !== params.fromNamespace) {
        return { memoIds: [], relationCount: 0 } satisfies NamespaceRenameResult;
      }

      const updated: MemoryEntry = {
        ...memo,
        namespace: params.toNamespace,
        updatedAt: new Date().toISOString(),
        version: memo.version + 1
      };
      this.memos.set(params.memoId, updated);
      return { memoIds: [params.memoId], relationCount: 0 } satisfies NamespaceRenameResult;
    }

    const memoUpdates: MemoryEntry[] = [];
    for (const memo of this.memos.values()) {
      if (memo.namespace === params.fromNamespace) {
        memoUpdates.push({
          ...memo,
          namespace: params.toNamespace,
          updatedAt: new Date().toISOString(),
          version: memo.version + 1
        });
      }
    }

    for (const updated of memoUpdates) {
      this.memos.set(updated.memoId, updated);
    }

    const memoIds = memoUpdates.map((memo) => memo.memoId);

    const relationUpdates: Array<{ oldKey: string; newKey: string; entry: RelationEntry }> = [];
    for (const [key, relation] of this.relations.entries()) {
      if (relation.namespace === params.fromNamespace) {
        const updated: RelationEntry = {
          ...relation,
          namespace: params.toNamespace,
          updatedAt: new Date().toISOString(),
          version: relation.version + 1
        };
        relationUpdates.push({ oldKey: key, newKey: relationKey(updated), entry: updated });
      }
    }

    for (const update of relationUpdates) {
      this.relations.set(update.newKey, update.entry);
      if (update.newKey !== update.oldKey) {
        this.relations.delete(update.oldKey);
      }
    }

    return { memoIds, relationCount: relationUpdates.length } satisfies NamespaceRenameResult;
  }

  private generateMemoId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    this.memoSequence += 1;
    const suffix = this.memoSequence.toString().padStart(12, "0");
    return `00000000-0000-0000-0000-${suffix}`;
  }
}

describe("memory MCP smoke", () => {
  it("runs primary memory workflow end-to-end", async () => {
    const store = new InMemoryStore();

    // Save first memo
    const saveResponse1 = await handleInvocation(
      { tool: "memory.save", params: { namespace: "notes", content: "Memo A" } },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.01)
      }
    );

    expect(saveResponse1.status).toBe(200);
    const saveJson1 = (await saveResponse1.json()) as MemorySaveResponse;
    expect(saveJson1.memo.namespace).toBe("workspace/inbox/notes");

    const memoIdA = saveJson1.memo.memoId;

    // Save second memo
    const saveResponse2 = await handleInvocation(
      { tool: "memory.save", params: { namespace: "notes", content: "Memo B" } },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.02)
      }
    );

    expect(saveResponse2.status).toBe(200);
    const saveJson2 = (await saveResponse2.json()) as MemorySaveResponse;
    const memoIdB = saveJson2.memo.memoId;

    // Create relation between memos
    const relationResponse = await handleInvocation(
      {
        tool: "memory.relation.save",
        params: {
          namespace: "notes",
          sourceMemoId: memoIdA,
          targetMemoId: memoIdB,
          tag: "related",
          weight: 0.6
        }
      },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.03)
      }
    );

    expect(relationResponse.status).toBe(200);
    const relationJson = (await relationResponse.json()) as RelationSaveResponse;
    expect(relationJson.relation.tag).toBe("related");

    // Update metadata property for version tracking
    const propertyResponseA = await handleInvocation(
      {
        tool: "memory.property",
        params: { namespace: "notes", memoId: memoIdA, name: "version", value: "1.0.0" }
      },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.031)
      }
    );
    expect(propertyResponseA.status).toBe(200);
    const propertyJsonA = (await propertyResponseA.json()) as MemoryPropertyResponse;
    expect(propertyJsonA.memo.metadata.version).toBe("1.0.0");
    expect(propertyJsonA.property.value).toBe(propertyJsonA.memo.metadata.version);
  expect(propertyJsonA.property.previousValue).toBe(null);
  expect(propertyJsonA.property.action).toBe("created");
  expect(propertyJsonA.property.changed).toBe(true);

    const propertyResponseB = await handleInvocation(
      {
        tool: "memory.property",
        params: { namespace: "notes", memoId: memoIdB, name: "version", value: "2.0.0" }
      },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.032)
      }
    );
    expect(propertyResponseB.status).toBe(200);
    const propertyJsonB = (await propertyResponseB.json()) as MemoryPropertyResponse;
    expect(propertyJsonB.property.value).toBe("2.0.0");
    expect(propertyJsonB.property.previousValue).toBe(null);
    expect(propertyJsonB.property.action).toBe("created");
    expect(propertyJsonB.property.changed).toBe(true);

    const propertyListResponse = await handleInvocation(
      {
        tool: "memory.property.list",
        params: { namespace: "notes", memoId: memoIdB }
      },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.033)
      }
    );

    expect(propertyListResponse.status).toBe(200);
    const propertyListJson = (await propertyListResponse.json()) as MemoryPropertyListResponse;
    expect(JSON.stringify(propertyListJson.properties)).toBe(JSON.stringify([
      { name: "version", value: "2.0.0" }
    ]));

    // List memos with version ordering and pagination
    const listResponsePage1 = await handleInvocation(
      {
        tool: "memory.list",
        params: { namespace: "notes", orderBy: "version", limit: 1 }
      },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.033)
      }
    );

    expect(listResponsePage1.status).toBe(200);
    const listJsonPage1 = (await listResponsePage1.json()) as MemoryListResponse;
    expect(listJsonPage1.items).toHaveLength(1);
    expect(listJsonPage1.items[0].memoId).toBe(memoIdB);
  expect(listJsonPage1.count).toBe(listJsonPage1.items.length);
    expect(typeof listJsonPage1.nextCursor).toBe("string");

    const listResponsePage2 = await handleInvocation(
      {
        tool: "memory.list",
        params: {
          namespace: "notes",
          orderBy: "version",
          limit: 1,
          cursor: listJsonPage1.nextCursor
        }
      },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.034)
      }
    );

    expect(listResponsePage2.status).toBe(200);
    const listJsonPage2 = (await listResponsePage2.json()) as MemoryListResponse;
    expect(listJsonPage2.items).toHaveLength(1);
    expect(listJsonPage2.items[0].memoId).toBe(memoIdA);
  expect(listJsonPage2.count).toBe(listJsonPage2.items.length);
    expect(listJsonPage2.nextCursor).toBe(undefined);

    const propertyDeleteResponse = await handleInvocation(
      {
        tool: "memory.property.delete",
        params: { namespace: "notes", memoId: memoIdB, name: "version" }
      },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.034)
      }
    );
    expect(propertyDeleteResponse.status).toBe(200);
    const propertyDeleteJson = (await propertyDeleteResponse.json()) as MemoryPropertyResponse;
    expect(propertyDeleteJson.property.value).toBe(null);
  expect(propertyDeleteJson.property.previousValue).toBe("2.0.0");
  expect(propertyDeleteJson.property.action).toBe("deleted");
  expect(propertyDeleteJson.property.changed).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(propertyDeleteJson.memo.metadata, "version")).toBe(false);

    // Search namespace
    const searchResponse = await handleInvocation(
      { tool: "memory.search", params: { namespace: "notes", query: "memo", k: 10 } },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.04)
      }
    );

    expect(searchResponse.status).toBe(200);
    const searchJson = (await searchResponse.json()) as MemorySearchResponse;
    expect(searchJson.count).toBe(2);

    // List namespaces rooted at notes
    const listResponse = await handleInvocation(
      {
        tool: "memory.list_namespaces",
        params: { namespace: "notes", depth: 1, limit: 10 }
      },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.05)
      }
    );

    expect(listResponse.status).toBe(200);
    const listJson = (await listResponse.json()) as MemoryListNamespacesResponse;
    expect(listJson.namespaces.includes("workspace/inbox/notes")).toBe(true);

    // Rename namespace to archive bucket
    const renameResponse = await handleInvocation(
      {
        tool: "memory.namespace.rename",
        params: { fromNamespace: "notes", toNamespace: "../archive/notes" }
      },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.06)
      }
    );

    expect(renameResponse.status).toBe(200);
    const renameJson = (await renameResponse.json()) as MemoryNamespaceRenameResponse;
    expect(renameJson.previousNamespace).toBe("workspace/inbox/notes");
    expect(renameJson.newNamespace).toBe("workspace/archive/notes");
    expect(renameJson.updatedCount).toBe(2);
    expect(renameJson.relationCount).toBe(1);

    // List relations in new namespace
    const relationListResponse = await handleInvocation(
      {
        tool: "memory.relation.list",
        params: { namespace: "../archive/notes", limit: 10 }
      },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.07)
      }
    );

    expect(relationListResponse.status).toBe(200);
    const relationListJson = (await relationListResponse.json()) as RelationListResponse;
    expect(relationListJson.count).toBe(1);
    expect(relationListJson.edges[0].namespace).toBe("workspace/archive/notes");

    // Delete one memo from archive namespace
    const deleteResponse = await handleInvocation(
      {
        tool: "memory.delete",
        params: { namespace: "../archive/notes", memoId: memoIdA }
      },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.08)
      }
    );

    expect(deleteResponse.status).toBe(200);
    const deleteJson = (await deleteResponse.json()) as MemoryDeleteResponse;
    expect(deleteJson.deleted).toBe(true);

    // Confirm single memo remains via search
    const postDeleteSearch = await handleInvocation(
      { tool: "memory.search", params: { namespace: "../archive/notes", query: "memo", k: 10 } },
      envStub,
      contextStub,
      {
        store,
        embed: async () => makeVector(0.09)
      }
    );

    expect(postDeleteSearch.status).toBe(200);
    const postDeleteJson = (await postDeleteSearch.json()) as MemorySearchResponse;
    expect(postDeleteJson.count).toBe(1);
  });
});
