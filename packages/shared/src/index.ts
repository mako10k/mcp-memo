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
