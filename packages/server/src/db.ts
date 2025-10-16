import { neon, neonConfig } from "@neondatabase/serverless";
import type {
  MemoMetadata,
  MemoryEntry,
  RelationEntry,
  RelationNode,
  RelationGraphEdge,
  DistanceMetric,
  RelationDirection
} from "@mcp/shared";

import type { EnvVars } from "./env";

neonConfig.fetchConnectionCache = true;

const VECTOR_DIMENSION = 1536;

type SqlClient = ReturnType<typeof neon>;
type TransactionCapableSql = SqlClient & {
  begin?<Result>(callback: (tx: SqlClient) => Promise<Result>): Promise<Result>;
};

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

interface NamespaceRow {
  namespace: string;
}

interface RelationRow {
  namespace: string;
  source_memo_id: string;
  target_memo_id: string;
  tag: string;
  weight: string | number;
  reason: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

interface RelationNodeRow {
  id: string;
  namespace: string;
  title: string | null;
}

interface RelationGraphRow extends RelationRow {
  depth: number;
  direction: "forward" | "backward";
  path_json: unknown;
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
  pivotMemoId?: string;
  distanceMetric: DistanceMetric;
  excludePivot?: boolean;
}

export interface DeleteParams {
  ownerId: string;
  namespace: string;
  memoId: string;
}

export interface ListNamespacesParams {
  ownerId: string;
  baseNamespace: string;
  depth: number;
  limit: number;
}

export interface RelationUpsertParams {
  ownerId: string;
  namespace: string;
  sourceMemoId: string;
  targetMemoId: string;
  tag: string;
  weight: number;
  reason?: string;
}

export interface RelationDeleteParams {
  ownerId: string;
  namespace: string;
  sourceMemoId: string;
  targetMemoId: string;
  tag: string;
}

export interface RelationListParams {
  ownerId: string;
  namespace: string;
  sourceMemoId?: string;
  targetMemoId?: string;
  tag?: string;
  limit: number;
}

export interface RelationListResult {
  edges: RelationEntry[];
  nodes: RelationNode[];
}

export interface RelationGraphParams {
  ownerId: string;
  namespace: string;
  startMemoId: string;
  maxDepth: number;
  direction: RelationDirection;
  tag?: string;
  limit: number;
}

export interface RelationGraphResult {
  edges: RelationGraphEdge[];
  nodes: RelationNode[];
}

export interface SearchResult extends MemoryEntry {
  score: number | null;
}

export interface NamespaceRenameParams {
  ownerId: string;
  fromNamespace: string;
  toNamespace: string;
  memoId?: string;
}

export interface NamespaceRenameResult {
  memoIds: string[];
  relationCount: number;
}

export interface MemoryStore {
  upsert(params: UpsertParams): Promise<MemoryEntry>;
  search(params: SearchParams): Promise<SearchResult[]>;
  delete(params: DeleteParams): Promise<MemoryEntry | null>;
  listNamespaces(params: ListNamespacesParams): Promise<string[]>;
  upsertRelation(params: RelationUpsertParams): Promise<RelationEntry>;
  deleteRelation(params: RelationDeleteParams): Promise<RelationEntry | null>;
  listRelations(params: RelationListParams): Promise<RelationListResult>;
  relationGraph(params: RelationGraphParams): Promise<RelationGraphResult>;
  renameNamespace(params: NamespaceRenameParams): Promise<NamespaceRenameResult>;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const withCode = error as { code?: string };
  return withCode.code === "23505";
}

function createNamespaceConflictError(): Error {
  const conflict = new Error("NAMESPACE_RENAME_CONFLICT");
  conflict.name = "NAMESPACE_RENAME_CONFLICT";
  return conflict;
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

function mapRelationRow(row: RelationRow): RelationEntry {
  return {
    namespace: row.namespace,
    sourceMemoId: row.source_memo_id,
    targetMemoId: row.target_memo_id,
    tag: row.tag,
    weight: typeof row.weight === "number" ? row.weight : Number.parseFloat(row.weight),
    reason: row.reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version
  } satisfies RelationEntry;
}

function mapRelationNodeRow(row: RelationNodeRow): RelationNode {
  return {
    memoId: row.id,
    namespace: row.namespace,
    title: row.title ?? undefined
  } satisfies RelationNode;
}

function splitNamespace(value: string): string[] {
  return value
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function startsWithSegments(full: string[], prefix: string[]): boolean {
  if (full.length < prefix.length) return false;
  return prefix.every((segment, index) => full[index] === segment);
}

function escapeForLike(value: string): string {
  return value.replace(/([_%\\])/g, "\\$1");
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
      const conditions: string[] = ["me.owner_id = $1", "me.namespace = $2"];
      const values: unknown[] = [params.ownerId, params.namespace];
      let scoreClause = "NULL::double precision AS score";
      let orderClause = "ORDER BY me.updated_at DESC";
      let fromClause = "FROM memory_entries me";
      let withClause = "";
      let vectorParamIndex: number | null = null;
      let pivotParamIndex: number | null = null;

      const metric = params.distanceMetric ?? "cosine";

      if (params.pivotMemoId) {
        const pivotCheck = (await sql(
          `
            SELECT 1
            FROM memory_entries
            WHERE owner_id = $1 AND namespace = $2 AND id = $3
            LIMIT 1;
          `,
          [params.ownerId, params.namespace, params.pivotMemoId]
        )) as unknown[];

        if (!pivotCheck.length) {
          throw new Error("PIVOT_NOT_FOUND");
        }

        values.push(params.pivotMemoId);
        pivotParamIndex = values.length;

        withClause = `WITH pivot AS (
          SELECT content_embedding
          FROM memory_entries
          WHERE owner_id = $1 AND namespace = $2 AND id = $${pivotParamIndex}
        )\n`;
        fromClause = "FROM memory_entries me CROSS JOIN pivot p";

        if (metric === "cosine") {
          scoreClause = "1 - (me.content_embedding <=> p.content_embedding) AS score";
          orderClause = "ORDER BY me.content_embedding <-> p.content_embedding";

          if (typeof params.minimumSimilarity === "number") {
            values.push(params.minimumSimilarity);
            const minParamIndex = values.length;
            conditions.push(`1 - (me.content_embedding <=> p.content_embedding) >= $${minParamIndex}`);
          }
        } else {
          scoreClause = "- (me.content_embedding <-> p.content_embedding) AS score";
          orderClause = "ORDER BY me.content_embedding <-> p.content_embedding";
        }

        if (params.excludePivot ?? true) {
          conditions.push(`me.id <> $${pivotParamIndex}`);
        }
      } else if (params.embedding) {
        const vectorLiteral = toVectorLiteral(params.embedding);
        values.push(vectorLiteral);
        vectorParamIndex = values.length;

        if (metric === "cosine") {
          scoreClause = `1 - (me.content_embedding <=> $${vectorParamIndex}::vector) AS score`;
          orderClause = `ORDER BY me.content_embedding <-> $${vectorParamIndex}::vector`;

          if (typeof params.minimumSimilarity === "number") {
            values.push(params.minimumSimilarity);
            const minParamIndex = values.length;
            conditions.push(`1 - (me.content_embedding <=> $${vectorParamIndex}::vector) >= $${minParamIndex}`);
          }
        } else {
          scoreClause = `- (me.content_embedding <-> $${vectorParamIndex}::vector) AS score`;
          orderClause = `ORDER BY me.content_embedding <-> $${vectorParamIndex}::vector`;
        }
      }

      if (params.metadataFilter && Object.keys(params.metadataFilter).length > 0) {
        values.push(JSON.stringify(params.metadataFilter));
        const metadataParamIndex = values.length;
        conditions.push(`me.metadata @> $${metadataParamIndex}::jsonb`);
      }

      values.push(params.k);
      const limitParamIndex = values.length;

      const query = `
        ${withClause}
  SELECT me.namespace, me.id, me.title, me.content, me.metadata, me.created_at, me.updated_at, me.version, ${scoreClause}
        ${fromClause}
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
    },

    async listNamespaces(params: ListNamespacesParams): Promise<string[]> {
      const base = params.baseNamespace.trim();
      if (!base) {
        throw new Error("Base namespace must not be empty");
      }

      const depth = Math.max(1, Math.min(params.depth, 5));
      const limit = Math.max(1, Math.min(params.limit, 500));

      const baseSegments = splitNamespace(base);
      const escapedBase = escapeForLike(base);
      const likePattern = `${escapedBase}/%`;

      const query = `
        SELECT DISTINCT namespace
        FROM memory_entries
        WHERE owner_id = $1
          AND (namespace = $2 OR namespace LIKE $3 ESCAPE '\\')
        ORDER BY namespace
        LIMIT $4;
      `;

      const rows = (await sql(query, [params.ownerId, base, likePattern, limit])) as NamespaceRow[];

      const maxSegments = baseSegments.length + depth;
      const namespaces = new Set<string>([base]);

      for (const row of rows) {
        const segments = splitNamespace(row.namespace);
        if (!startsWithSegments(segments, baseSegments)) continue;
        const truncated = segments.slice(0, Math.min(segments.length, maxSegments));
        if (truncated.length < baseSegments.length) continue;
        namespaces.add(truncated.join("/"));
      }

      return Array.from(namespaces).sort();
    },

    async upsertRelation(params: RelationUpsertParams): Promise<RelationEntry> {
      const query = `
        INSERT INTO memory_relations (owner_id, namespace, source_memo_id, target_memo_id, tag, weight, reason, created_at, updated_at, version)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), 1)
        ON CONFLICT (owner_id, namespace, source_memo_id, target_memo_id, tag) DO UPDATE
        SET
          weight = EXCLUDED.weight,
          reason = EXCLUDED.reason,
          updated_at = NOW(),
          version = memory_relations.version + 1
        RETURNING namespace, source_memo_id, target_memo_id, tag, weight, reason, created_at, updated_at, version;
      `;

      const rows = (await sql(query, [
        params.ownerId,
        params.namespace,
        params.sourceMemoId,
        params.targetMemoId,
        params.tag,
        params.weight,
        params.reason ?? null
      ])) as RelationRow[];

      if (!rows.length) {
        throw new Error("Failed to upsert memory relation");
      }

      return mapRelationRow(rows[0]);
    },

    async deleteRelation(params: RelationDeleteParams): Promise<RelationEntry | null> {
      const query = `
        DELETE FROM memory_relations
        WHERE owner_id = $1 AND namespace = $2 AND source_memo_id = $3 AND target_memo_id = $4 AND tag = $5
        RETURNING namespace, source_memo_id, target_memo_id, tag, weight, reason, created_at, updated_at, version;
      `;

      const rows = (await sql(query, [
        params.ownerId,
        params.namespace,
        params.sourceMemoId,
        params.targetMemoId,
        params.tag
      ])) as RelationRow[];

      if (!rows.length) {
        return null;
      }

      return mapRelationRow(rows[0]);
    },

    async listRelations(params: RelationListParams): Promise<RelationListResult> {
      const conditions: string[] = ["owner_id = $1", "namespace = $2"];
      const values: unknown[] = [params.ownerId, params.namespace];

      if (params.sourceMemoId) {
        values.push(params.sourceMemoId);
        conditions.push(`source_memo_id = $${values.length}`);
      }

      if (params.targetMemoId) {
        values.push(params.targetMemoId);
        conditions.push(`target_memo_id = $${values.length}`);
      }

      if (params.tag) {
        values.push(params.tag);
        conditions.push(`tag = $${values.length}`);
      }

      values.push(params.limit);
      const limitParamIndex = values.length;

      const relationQuery = `
        SELECT namespace, source_memo_id, target_memo_id, tag, weight, reason, created_at, updated_at, version
        FROM memory_relations
        WHERE ${conditions.join(" AND ")}
        ORDER BY updated_at DESC
        LIMIT $${limitParamIndex};
      `;

      const relationRows = (await sql(relationQuery, values)) as RelationRow[];
      const edges = relationRows.map(mapRelationRow);

      if (edges.length === 0) {
        return { edges: [], nodes: [] } satisfies RelationListResult;
      }

      const memoIds = Array.from(
        new Set(edges.flatMap((edge) => [edge.sourceMemoId, edge.targetMemoId]))
      );

      const nodesQuery = `
        SELECT id, namespace, title
        FROM memory_entries
        WHERE owner_id = $1 AND namespace = $2 AND id = ANY($3::uuid[]);
      `;

      const nodeRows = (await sql(nodesQuery, [params.ownerId, params.namespace, memoIds])) as RelationNodeRow[];
      const nodes = nodeRows.map(mapRelationNodeRow);

      return { edges, nodes } satisfies RelationListResult;
    },

    async renameNamespace(params: NamespaceRenameParams): Promise<NamespaceRenameResult> {
      if (params.memoId) {
        try {
          const rows = (await sql(
            `
              UPDATE memory_entries
              SET namespace = $4, updated_at = NOW(), version = memory_entries.version + 1
              WHERE owner_id = $1 AND namespace = $2 AND id = $3
              RETURNING id;
            `,
            [params.ownerId, params.fromNamespace, params.memoId, params.toNamespace]
          )) as Array<{ id: string }>;

          return {
            memoIds: rows.map((row) => row.id),
            relationCount: 0
          } satisfies NamespaceRenameResult;
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw createNamespaceConflictError();
          }
          throw error;
        }
      }

      if (params.fromNamespace === params.toNamespace) {
        return {
          memoIds: [],
          relationCount: 0
        } satisfies NamespaceRenameResult;
      }

      try {
        const transactionCapable = sql as TransactionCapableSql;
        if (typeof transactionCapable.begin !== "function") {
          throw new Error("TRANSACTIONS_UNSUPPORTED");
        }

        return await transactionCapable.begin(async (tx: SqlClient) => {
          const memoRows = (await tx(
            `
              UPDATE memory_entries
              SET namespace = $3, updated_at = NOW(), version = memory_entries.version + 1
              WHERE owner_id = $1 AND namespace = $2
              RETURNING id;
            `,
            [params.ownerId, params.fromNamespace, params.toNamespace]
          )) as Array<{ id: string }>;

          if (!memoRows.length) {
            return {
              memoIds: [],
              relationCount: 0
            } satisfies NamespaceRenameResult;
          }

          const relationRows = (await tx(
            `
              UPDATE memory_relations
              SET namespace = $3, updated_at = NOW(), version = memory_relations.version + 1
              WHERE owner_id = $1 AND namespace = $2
              RETURNING source_memo_id;
            `,
            [params.ownerId, params.fromNamespace, params.toNamespace]
          )) as Array<{ source_memo_id: string }>;

          return {
            memoIds: memoRows.map((row) => row.id),
            relationCount: relationRows.length
          } satisfies NamespaceRenameResult;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw createNamespaceConflictError();
        }
        throw error;
      }
    },

    async relationGraph(params: RelationGraphParams): Promise<RelationGraphResult> {
      const includeForward = params.direction === "forward" || params.direction === "both";
      const includeBackward = params.direction === "backward" || params.direction === "both";

      if (!includeForward && !includeBackward) {
        return { edges: [], nodes: [] } satisfies RelationGraphResult;
      }

      const values: unknown[] = [params.ownerId, params.namespace, params.startMemoId];
      let tagParamIndex: number | null = null;
      if (params.tag) {
        values.push(params.tag);
        tagParamIndex = values.length;
      }

      values.push(params.maxDepth);
      const depthParamIndex = values.length;
      values.push(params.limit);
      const limitParamIndex = values.length;

      const tagFilterInitial = tagParamIndex ? ` AND r.tag = $${tagParamIndex}` : "";
      const tagFilterRecursive = tagParamIndex ? ` AND r.tag = $${tagParamIndex}` : "";

      const cteDefinitions: string[] = [];

      if (includeForward) {
        cteDefinitions.push(`forward_traversal AS (
  SELECT
    r.namespace,
    r.source_memo_id,
    r.target_memo_id,
    r.tag,
    r.weight,
    r.reason,
    r.created_at,
    r.updated_at,
    r.version,
    ARRAY[$3::uuid, r.target_memo_id] AS path,
    1 AS depth,
    'forward'::text AS direction
  FROM memory_relations r
  WHERE r.owner_id = $1 AND r.namespace = $2 AND r.source_memo_id = $3${tagFilterInitial}
  UNION ALL
  SELECT
    r.namespace,
    r.source_memo_id,
    r.target_memo_id,
    r.tag,
    r.weight,
    r.reason,
    r.created_at,
    r.updated_at,
    r.version,
    ft.path || r.target_memo_id,
    ft.depth + 1,
    'forward'::text AS direction
  FROM forward_traversal ft
  JOIN memory_relations r
    ON r.owner_id = $1 AND r.namespace = $2 AND r.source_memo_id = ft.target_memo_id
  WHERE ft.depth < $${depthParamIndex}${tagFilterRecursive} AND NOT r.target_memo_id = ANY(ft.path)
)`);
      }

      if (includeBackward) {
        cteDefinitions.push(`backward_traversal AS (
  SELECT
    r.namespace,
    r.source_memo_id,
    r.target_memo_id,
    r.tag,
    r.weight,
    r.reason,
    r.created_at,
    r.updated_at,
    r.version,
    ARRAY[$3::uuid, r.source_memo_id] AS path,
    1 AS depth,
    'backward'::text AS direction
  FROM memory_relations r
  WHERE r.owner_id = $1 AND r.namespace = $2 AND r.target_memo_id = $3${tagFilterInitial}
  UNION ALL
  SELECT
    r.namespace,
    r.source_memo_id,
    r.target_memo_id,
    r.tag,
    r.weight,
    r.reason,
    r.created_at,
    r.updated_at,
    r.version,
    bt.path || r.source_memo_id,
    bt.depth + 1,
    'backward'::text AS direction
  FROM backward_traversal bt
  JOIN memory_relations r
    ON r.owner_id = $1 AND r.namespace = $2 AND r.target_memo_id = bt.source_memo_id
  WHERE bt.depth < $${depthParamIndex}${tagFilterRecursive} AND NOT r.source_memo_id = ANY(bt.path)
)`);
      }

    const withClause = cteDefinitions.length ? `WITH RECURSIVE ${cteDefinitions.join(",\n")}` : "";

      const traversalSelects: string[] = [];
      if (includeForward) {
        traversalSelects.push("SELECT * FROM forward_traversal");
      }
      if (includeBackward) {
        traversalSelects.push("SELECT * FROM backward_traversal");
      }

      const traversalSource = traversalSelects.join("\nUNION ALL\n");

      const query = `
        ${withClause}
        SELECT
          namespace,
          source_memo_id,
          target_memo_id,
          tag,
          weight,
          reason,
          created_at,
          updated_at,
          version,
          depth,
          direction,
          to_jsonb(path) AS path_json
        FROM (
          ${traversalSource}
        ) combined
        ORDER BY depth, updated_at DESC
        LIMIT $${limitParamIndex};
      `;

      const rows = traversalSource
        ? ((await sql(query, values)) as RelationGraphRow[])
        : [];

      const normalizePath = (value: unknown): string[] => {
        if (Array.isArray(value)) {
          return value.map((item) => String(item));
        }
        if (typeof value === "string") {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              return parsed.map((item) => String(item));
            }
          } catch (error) {
            console.warn("Failed to parse relation path JSON", error);
          }
        }
        if (value && typeof value === "object") {
          try {
            const stringified = JSON.stringify(value);
            const parsed = JSON.parse(stringified);
            if (Array.isArray(parsed)) {
              return parsed.map((item) => String(item));
            }
          } catch (error) {
            console.warn("Failed to normalise relation path object", error);
          }
        }
        return [];
      };

      const edges: RelationGraphEdge[] = rows.map((row) => ({
        ...mapRelationRow(row),
        depth: row.depth,
        direction: row.direction,
        path: normalizePath(row.path_json)
      }));

      if (edges.length === 0) {
        return { edges: [], nodes: [] } satisfies RelationGraphResult;
      }

      const memoIds = new Set<string>([params.startMemoId]);
      for (const edge of edges) {
        memoIds.add(edge.sourceMemoId);
        memoIds.add(edge.targetMemoId);
        for (const id of edge.path) {
          memoIds.add(id);
        }
      }

      const nodesQuery = `
        SELECT id, namespace, title
        FROM memory_entries
        WHERE owner_id = $1 AND namespace = $2 AND id = ANY($3::uuid[]);
      `;

      const nodeRows = (await sql(nodesQuery, [
        params.ownerId,
        params.namespace,
        Array.from(memoIds)
      ])) as RelationNodeRow[];

      const nodes = nodeRows.map(mapRelationNodeRow);

      return { edges, nodes } satisfies RelationGraphResult;
    }
  };
}
