// Shared types and utilities will be placed here.
export type MemoMetadata = Record<string, unknown>;

export interface MemoryEntry {
  memoId: string;
  namespace: string;
  title?: string;
  content: string;
  metadata: MemoMetadata;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MemorySearchResult extends MemoryEntry {
  score: number | null;
}

export interface MemorySaveResponse {
  memo: MemoryEntry;
  rootNamespace: string;
}

export interface MemorySearchResponse {
  items: MemorySearchResult[];
  count: number;
  rootNamespace: string;
}

export interface MemoryDeleteResponse {
  deleted: boolean;
  memo?: MemoryEntry;
  rootNamespace: string;
}

export interface MemoryListNamespacesResponse {
  baseNamespace: string;
  defaultNamespace: string;
  rootNamespace: string;
  depth: number;
  count: number;
  namespaces: string[];
}

export interface MemoryPropertyResponse {
  memo: MemoryEntry;
  property: {
    name: string;
    value: unknown;
  };
  rootNamespace: string;
}

export interface MemoryListResponse {
  namespace: string;
  rootNamespace: string;
  items: MemoryEntry[];
  count: number;
  limit: number;
  orderBy?: string;
  orderDirection: "asc" | "desc";
  cursor?: string;
  nextCursor?: string;
}

export interface MemoryNamespaceRenameResponse {
  previousNamespace: string;
  newNamespace: string;
  updatedCount: number;
  memoIds: string[];
  relationCount: number;
  rootNamespace: string;
}

export interface RelationEntry {
  namespace: string;
  sourceMemoId: string;
  targetMemoId: string;
  tag: string;
  weight: number;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface RelationNode {
  memoId: string;
  namespace: string;
  title?: string;
}

export interface RelationGraphEdge extends RelationEntry {
  depth: number;
  path: string[];
  direction: "forward" | "backward";
}

export interface RelationSaveResponse {
  relation: RelationEntry;
  rootNamespace: string;
}

export interface RelationDeleteResponse {
  deleted: boolean;
  relation?: RelationEntry;
  rootNamespace: string;
}

export interface RelationListResponse {
  namespace: string;
  rootNamespace: string;
  count: number;
  edges: RelationEntry[];
  nodes: RelationNode[];
}

export interface RelationGraphResponse {
  namespace: string;
  rootNamespace: string;
  count: number;
  edges: RelationGraphEdge[];
  nodes: RelationNode[];
}

export interface InferenceGuidanceAction {
  label: string;
  command?: string;
  description: string;
}

export interface InferenceGuidancePhase {
  id: string;
  title: string;
  objective: string;
  documentation: string;
  recommendedTools: string[];
  scripts: InferenceGuidanceAction[];
  outputs: string[];
  nextSteps: string[];
}

export interface MemoryInferenceGuidanceResponse {
  language: "en" | "ja";
  summary: string;
  prerequisites: string[];
  phases: InferenceGuidancePhase[];
  followUp: {
    automation: string;
    maintenance: string[];
  };
  references: {
    docs: string[];
    scripts: string[];
  };
}

export * from "./schemas";
