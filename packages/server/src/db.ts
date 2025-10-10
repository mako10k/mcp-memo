import { neon, neonConfig } from "@neondatabase/serverless";
import type { MemoMetadata, MemoryEntry } from "@mcp/shared";

import type { EnvVars } from "./env";

neonConfig.fetchConnectionCache = true;

const VECTOR_DIMENSION = 1536;

interface MemoryRow {
  namespace: string;
  id: string;
  title: string | null;
  content: string;
  metadata: MemoMetadata;
  created_at: string;
  updated_at: string;
  version: number;
  score?: number | null;
}

export interface UpsertParams {
  ownerId: string;
  namespace: string;
  memoId?: string;
  title?: string;
  content: string;
  metadataPatch?: MemoMetadata;
  embedding: number[];
}

export interface SearchParams {
  ownerId: string;
  namespace: string;
  embedding?: number[];
  metadataFilter?: MemoMetadata;
  k: number;
  minimumSimilarity?: number;
}

export interface DeleteParams {
  ownerId: string;
  namespace: string;
  memoId: string;
}

export interface SearchResult extends MemoryEntry {
  score: number | null;
}

export interface MemoryStore {
  upsert(params: UpsertParams): Promise<MemoryEntry>;
  search(params: SearchParams): Promise<SearchResult[]>;
  delete(params: DeleteParams): Promise<MemoryEntry | null>;
}

function toVectorLiteral(vector: number[]): string {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("Embedding vector is empty");
  }
  if (vector.length !== VECTOR_DIMENSION) {
    throw new Error(`Embedding vector must have ${VECTOR_DIMENSION} dimensions, received ${vector.length}`);
  }
  if (vector.some((value) => Number.isNaN(value))) {
    throw new Error("Embedding vector contains NaN values");
  }
  return `[${vector.join(",")}]`;
}

function mapRow(row: MemoryRow): MemoryEntry {
  return {
    namespace: row.namespace,
    memoId: row.id,
    title: row.title ?? undefined,
    content: row.content,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version
  };
}

export function createMemoryStore(env: EnvVars): MemoryStore {
  const sql = neon(env.DATABASE_URL);

  return {
    async upsert(params: UpsertParams): Promise<MemoryEntry> {
      const memoId = params.memoId ?? crypto.randomUUID();
      const metadataPatchJson = params.metadataPatch ? JSON.stringify(params.metadataPatch) : null;
      const metadataInitialJson = metadataPatchJson ?? "{}";
      const vectorLiteral = toVectorLiteral(params.embedding);

      const query = `
        INSERT INTO memory_entries (owner_id, namespace, id, title, content, content_embedding, metadata, created_at, updated_at, version)
        VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, NOW(), NOW(), 1)
        ON CONFLICT (owner_id, namespace, id) DO UPDATE
        SET
          title = COALESCE(EXCLUDED.title, memory_entries.title),
          content = EXCLUDED.content,
          content_embedding = EXCLUDED.content_embedding,
          metadata = CASE WHEN $8::jsonb IS NULL THEN memory_entries.metadata ELSE memory_entries.metadata || $8::jsonb END,
          updated_at = NOW(),
          version = memory_entries.version + 1
        RETURNING namespace, id, title, content, metadata, created_at, updated_at, version;
      `;

      const rows = (await sql(query, [
        params.ownerId,
        params.namespace,
        memoId,
        params.title ?? null,
        params.content,
        vectorLiteral,
        metadataInitialJson,
        metadataPatchJson
      ])) as MemoryRow[];

      if (!rows.length) {
        throw new Error("Failed to upsert memory entry");
      }

      return mapRow(rows[0]);
    },

    async search(params: SearchParams): Promise<SearchResult[]> {
      const conditions: string[] = ["owner_id = $1", "namespace = $2"];
      const values: unknown[] = [params.ownerId, params.namespace];
      let scoreClause = "NULL::double precision AS score";
      let orderClause = "ORDER BY updated_at DESC";

      let vectorParamIndex: number | null = null;

      if (params.embedding) {
        const vectorLiteral = toVectorLiteral(params.embedding);
        values.push(vectorLiteral);
        vectorParamIndex = values.length;
        scoreClause = `1 - (content_embedding <=> $${vectorParamIndex}::vector) AS score`;
        orderClause = `ORDER BY content_embedding <-> $${vectorParamIndex}::vector`;

        if (typeof params.minimumSimilarity === "number") {
          values.push(params.minimumSimilarity);
          const minParamIndex = values.length;
          conditions.push(`1 - (content_embedding <=> $${vectorParamIndex}::vector) >= $${minParamIndex}`);
        }
      }

      if (params.metadataFilter && Object.keys(params.metadataFilter).length > 0) {
        values.push(JSON.stringify(params.metadataFilter));
        const metadataParamIndex = values.length;
        conditions.push(`metadata @> $${metadataParamIndex}::jsonb`);
      }

      values.push(params.k);
      const limitParamIndex = values.length;

      const query = `
        SELECT namespace, id, title, content, metadata, created_at, updated_at, version, ${scoreClause}
        FROM memory_entries
        WHERE ${conditions.join(" AND ")}
        ${orderClause}
        LIMIT $${limitParamIndex};
      `;

      const rows = (await sql(query, values)) as MemoryRow[];

      return rows.map((row) => ({ ...mapRow(row), score: row.score ?? null }));
    },

    async delete(params: DeleteParams): Promise<MemoryEntry | null> {
      const query = `
        DELETE FROM memory_entries
        WHERE owner_id = $1 AND namespace = $2 AND id = $3
        RETURNING namespace, id, title, content, metadata, created_at, updated_at, version;
      `;
      const rows = (await sql(query, [params.ownerId, params.namespace, params.memoId])) as MemoryRow[];
      if (!rows.length) {
        return null;
      }
      return mapRow(rows[0]);
    }
  };
}
