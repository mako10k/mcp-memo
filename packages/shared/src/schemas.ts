import { z } from "zod";

const primitiveValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const metadataValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([primitiveValue, z.array(metadataValueSchema), z.record(metadataValueSchema)])
);

export const metadataSchema = z.record(metadataValueSchema);

const relationTagSchema = z.string().min(1).max(64);
const relationWeightSchema = z.coerce.number().min(0).max(1);
const distanceMetricSchema = z.enum(["cosine", "l2"]);
const relationDirectionSchema = z.enum(["forward", "backward", "both"]);

export const relationSaveInputSchema = z.object({
  namespace: z.string().min(1).optional(),
  sourceMemoId: z.string().uuid(),
  targetMemoId: z.string().uuid(),
  tag: relationTagSchema,
  weight: relationWeightSchema,
  reason: z.string().min(1).optional()
});

export const relationDeleteInputSchema = z.object({
  namespace: z.string().min(1).optional(),
  sourceMemoId: z.string().uuid(),
  targetMemoId: z.string().uuid(),
  tag: relationTagSchema
});

export const relationListInputSchema = z.object({
  namespace: z.string().min(1).optional(),
  sourceMemoId: z.string().uuid().optional(),
  targetMemoId: z.string().uuid().optional(),
  tag: relationTagSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

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
  minimumSimilarity: z.coerce.number().min(0).max(1).optional(),
  pivotMemoId: z.string().uuid().optional(),
  distanceMetric: distanceMetricSchema.default("cosine"),
  excludePivot: z.boolean().optional()
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

export const relationGraphInputSchema = z.object({
  namespace: z.string().min(1).optional(),
  startMemoId: z.string().uuid(),
  maxDepth: z.coerce.number().int().min(1).max(10).default(3),
  direction: relationDirectionSchema.default("forward"),
  tag: relationTagSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200)
});

export const toolInvocationSchema = z.object({
  tool: z.enum([
    "memory.save",
    "memory.search",
    "memory.delete",
    "memory.list_namespaces",
    "memory.relation.save",
    "memory.relation.delete",
    "memory.relation.list",
    "memory.relation.graph"
  ]),
  params: z.unknown().optional()
});

export type SaveInput = z.infer<typeof saveInputSchema>;
export type SearchInput = z.infer<typeof searchInputSchema>;
export type DeleteInput = z.infer<typeof deleteInputSchema>;
export type ListNamespacesInput = z.infer<typeof listNamespacesInputSchema>;
export type RelationSaveInput = z.infer<typeof relationSaveInputSchema>;
export type RelationDeleteInput = z.infer<typeof relationDeleteInputSchema>;
export type RelationListInput = z.infer<typeof relationListInputSchema>;
export type RelationGraphInput = z.infer<typeof relationGraphInputSchema>;
export type ToolInvocation = z.infer<typeof toolInvocationSchema>;
export type DistanceMetric = z.infer<typeof distanceMetricSchema>;
export type RelationDirection = z.infer<typeof relationDirectionSchema>;
