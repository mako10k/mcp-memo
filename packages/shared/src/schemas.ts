import { z } from "zod";

const primitiveValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const metadataValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([primitiveValue, z.array(metadataValueSchema), z.record(metadataValueSchema)])
);

export const metadataSchema = z.record(metadataValueSchema);

export const saveInputSchema = z.object({
  namespace: z.string().min(1),
  content: z.string().min(1),
  metadata: metadataSchema.optional(),
  memoId: z.string().min(1).optional(),
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
  memoId: z.string().min(1)
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
