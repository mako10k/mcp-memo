import { z } from "zod";

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
}

export interface MemorySearchResponse {
  items: MemorySearchResult[];
  count: number;
}

export interface MemoryDeleteResponse {
  deleted: boolean;
  memo?: MemoryEntry;
}

export interface MemoryListNamespacesResponse {
  baseNamespace: string;
  defaultNamespace: string;
  rootNamespace: string;
  depth: number;
  count: number;
  namespaces: string[];
}

const primitiveValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const metadataValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([primitiveValue, z.array(metadataValueSchema), z.record(metadataValueSchema)])
);

export const metadataSchema = z.record(metadataValueSchema);

export const saveInputSchema = z.object({
  namespace: z.string().min(1),
  content: z.string().min(1),
  metadata: metadataSchema.optional(),
  memoId: z.string().uuid().optional(),
  title: z.string().min(1).optional()
});

export const searchInputSchema = z.object({
  namespace: z.string().min(1),
  query: z.string().min(1).optional(),
  metadataFilter: metadataSchema.optional(),
  k: z.coerce.number().int().min(1).max(100).default(10),
  minimumSimilarity: z.coerce.number().min(0).max(1).optional()
});

export const deleteInputSchema = z.object({
  namespace: z.string().min(1),
  memoId: z.string().uuid()
});

export const listNamespacesInputSchema = z.object({
  namespace: z.string().min(1).optional(),
  depth: z.coerce.number().int().min(1).max(5).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

export const toolInvocationSchema = z.object({
  tool: z.enum(["memory.save", "memory.search", "memory.delete", "memory.list_namespaces"]),
  params: z.unknown().optional()
});

export type SaveInput = z.infer<typeof saveInputSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
export type DeleteInput = z.infer<typeof deleteInputSchema>;
export type ListNamespacesInput = z.infer<typeof listNamespacesInputSchema>;
export type ToolInvocation = z.infer<typeof toolInvocationSchema>;
