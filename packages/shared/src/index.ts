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

export * from "./schemas";
