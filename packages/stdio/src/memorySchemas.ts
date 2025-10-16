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

export const inferenceGuidanceInputSchema = z.object({
  language: z.enum(["en", "ja"]).optional()
});

const thinkSupportPhaseSchema = z.enum(["divergence", "clustering", "convergence"]);

const thinkSupportIdeaInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  metadata: metadataSchema.optional()
});

const thinkSupportEvaluationCriterionSchema = z.object({
  name: z.string().min(1),
  definition: z.string().min(1),
  weight: z.coerce.number().min(0).max(1).optional()
});

const thinkSupportCandidateClusterSchema = z.object({
  clusterId: z.string().min(1),
  label: z.string().min(1),
  summary: z.string().min(1),
  memberIdeaIds: z.array(z.string().min(1)).min(1)
});

export const memoryThinkSupportInputSchema = z
  .object({
    phase: thinkSupportPhaseSchema,
    topic: z.string().min(1),
    constraints: z.array(z.string().min(1)).optional(),
    seedAngles: z.array(z.string().min(1)).optional(),
    ideas: z.array(thinkSupportIdeaInputSchema).optional(),
    evaluationCriteria: z.array(thinkSupportEvaluationCriterionSchema).optional(),
    criteria: z.array(z.string().min(1)).optional(),
    candidateIdeaIds: z.array(z.string().min(1)).optional(),
    candidateClusters: z.array(thinkSupportCandidateClusterSchema).optional(),
    humanShortlist: z.array(z.string().min(1)).optional()
  })
  .passthrough();

const thinkSupportIdeaSchema = thinkSupportIdeaInputSchema.extend({
  inspirationSource: z.string().min(1).optional(),
  riskNotes: z.array(z.string().min(1)).optional()
});

const thinkSupportClusterSchema = z.object({
  clusterId: z.string().min(1),
  label: z.string().min(1),
  rationale: z.string().min(1),
  memberIdeaIds: z.array(z.string().min(1)).min(1),
  refinementPrompts: z.array(z.string().min(1)).optional()
});

const thinkSupportOutlierSchema = z.object({
  ideaId: z.string().min(1),
  note: z.string().min(1)
});

const thinkSupportRankedIdeaSchema = z.object({
  ideaId: z.string().min(1),
  scoreBreakdown: z.record(z.number()),
  overallRationale: z.string().min(1),
  nextSteps: z.array(z.string().min(1)).optional()
});

const thinkSupportTradeoffSchema = z.object({
  ideaId: z.string().min(1),
  risks: z.array(z.string().min(1)).optional(),
  assumptions: z.array(z.string().min(1)).optional(),
  validationTasks: z.array(z.string().min(1)).optional()
});

export const memoryThinkSupportDivergenceOutputSchema = z.object({
  phase: z.literal("divergence"),
  ideas: z.array(thinkSupportIdeaSchema).min(1),
  coverage: z.string().min(1),
  nextRecommendation: z.string().min(1),
  warnings: z.array(z.string().min(1)).optional()
});

export const memoryThinkSupportClusteringOutputSchema = z.object({
  phase: z.literal("clustering"),
  clusters: z.array(thinkSupportClusterSchema).min(1),
  outliers: z.array(thinkSupportOutlierSchema).optional(),
  nextRecommendation: z.string().min(1),
  warnings: z.array(z.string().min(1)).optional()
});

export const memoryThinkSupportConvergenceOutputSchema = z.object({
  phase: z.literal("convergence"),
  rankedIdeas: z.array(thinkSupportRankedIdeaSchema).min(1),
  tradeoffs: z.array(thinkSupportTradeoffSchema).optional(),
  handoffSummary: z.string().min(1),
  nextRecommendation: z.string().min(1).optional(),
  warnings: z.array(z.string().min(1)).optional()
});

export const memoryThinkSupportOutputSchema = z.discriminatedUnion("phase", [
  memoryThinkSupportDivergenceOutputSchema,
  memoryThinkSupportClusteringOutputSchema,
  memoryThinkSupportConvergenceOutputSchema
]);

export const tweetInputSchema = z.object({
  text: z.string().min(1).max(500),
  language: z.enum(["en", "ja"]).optional()
});

export const tweetReactionOutputSchema = z.object({
  reaction: z.string().min(1),
  language: z.enum(["en", "ja"]).optional()
});

export const thinkInputSchema = z.object({}).passthrough();

export const toolInvocationSchema = z.object({
  tool: z.enum([
    "memory.save",
    "memory.search",
    "memory.delete",
    "memory.list_namespaces",
    "memory.relation.save",
    "memory.relation.delete",
    "memory.relation.list",
    "memory.relation.graph",
    "memory.inference.guidance",
    "memory.think.support",
    "tweet",
    "think"
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
export type InferenceGuidanceInput = z.infer<typeof inferenceGuidanceInputSchema>;
export type MemoryThinkSupportPhase = z.infer<typeof thinkSupportPhaseSchema>;
export type MemoryThinkSupportInput = z.infer<typeof memoryThinkSupportInputSchema>;
export type MemoryThinkSupportIdea = z.infer<typeof thinkSupportIdeaSchema>;
export type MemoryThinkSupportCluster = z.infer<typeof thinkSupportClusterSchema>;
export type MemoryThinkSupportDivergenceOutput = z.infer<typeof memoryThinkSupportDivergenceOutputSchema>;
export type MemoryThinkSupportClusteringOutput = z.infer<typeof memoryThinkSupportClusteringOutputSchema>;
export type MemoryThinkSupportConvergenceOutput = z.infer<typeof memoryThinkSupportConvergenceOutputSchema>;
export type MemoryThinkSupportOutput = z.infer<typeof memoryThinkSupportOutputSchema>;
export type TweetInput = z.infer<typeof tweetInputSchema>;
export type TweetReactionOutput = z.infer<typeof tweetReactionOutputSchema>;
export type ThinkInput = z.infer<typeof thinkInputSchema>;
export type ToolInvocation = z.infer<typeof toolInvocationSchema>;
export type DistanceMetric = z.infer<typeof distanceMetricSchema>;
export type RelationDirection = z.infer<typeof relationDirectionSchema>;
