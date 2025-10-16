import {
  memoryThinkSupportClusteringOutputSchema,
  memoryThinkSupportConvergenceOutputSchema,
  memoryThinkSupportDivergenceOutputSchema,
  memoryThinkSupportInputSchema,
  memoryThinkSupportOutputSchema,
  type MemoryThinkSupportInput,
  type MemoryThinkSupportOutput
} from "./schemas";
import { generateStructuredChatCompletion } from "./openai";
import type { EnvVars } from "./env";

const BASE_SYSTEM_PROMPT = `You are an AI brainstorming facilitator that supports a primary assistant.
Always return concise JSON without markdown. Keep text within each field short and practical.
Use the provided schema exactly and avoid adding unexpected keys.`;

interface PromptConfig {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  schema:
    | typeof memoryThinkSupportDivergenceOutputSchema
    | typeof memoryThinkSupportClusteringOutputSchema
    | typeof memoryThinkSupportConvergenceOutputSchema;
}

function formatList(title: string, values?: string[]): string {
  if (!values?.length) return "";
  const lines = values.map((value) => `- ${value}`).join("\n");
  return `${title}:\n${lines}`;
}

function formatIdeas(ideas?: MemoryThinkSupportInput["ideas"]): string {
  if (!ideas?.length) return "";
  const blocks = ideas.map((idea) => {
    const metadata = idea.metadata ? `\n  metadata: ${JSON.stringify(idea.metadata)}` : "";
    return `- ${idea.id}: ${idea.title}\n  summary: ${idea.summary}${metadata}`;
  });
  return `Ideas:\n${blocks.join("\n")}`;
}

function formatCandidateClusters(clusters?: MemoryThinkSupportInput["candidateClusters"]): string {
  if (!clusters?.length) return "";
  const blocks = clusters.map((cluster) => {
    return `- ${cluster.clusterId}: ${cluster.label}\n  summary: ${cluster.summary}\n  members: ${cluster.memberIdeaIds.join(", ")}`;
  });
  return `Candidate clusters:\n${blocks.join("\n")}`;
}

function formatEvaluationCriteria(criteria?: MemoryThinkSupportInput["evaluationCriteria"]): string {
  if (!criteria?.length) return "";
  const lines = criteria.map((criterion) => {
    const weightPart = typeof criterion.weight === "number" ? ` (weight: ${criterion.weight.toFixed(2)})` : "";
    return `- ${criterion.name}${weightPart}: ${criterion.definition}`;
  });
  return `Evaluation criteria:\n${lines.join("\n")}`;
}

function buildDivergencePrompt(input: MemoryThinkSupportInput): PromptConfig {
  const systemPrompt = `${BASE_SYSTEM_PROMPT}\nGenerate between four and six distinct ideas. Encourage diversity across approach, audience, and risk level.`;
  const sections = [
    `Phase: divergence`,
    `Topic: ${input.topic}`,
    formatList("Constraints", input.constraints),
    formatList("Seed angles", input.seedAngles)
  ].filter(Boolean);

  const userPrompt = sections.join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    temperature: 0.9,
    topP: 0.95,
    maxOutputTokens: 1200,
    schema: memoryThinkSupportDivergenceOutputSchema
  };
}

function buildClusteringPrompt(input: MemoryThinkSupportInput): PromptConfig {
  const systemPrompt = `${BASE_SYSTEM_PROMPT}\nGroup the provided ideas into three to six themes. Explain the rationale and suggest follow-up prompts for continued exploration.`;
  const sections = [
    `Phase: clustering`,
    `Topic: ${input.topic}`,
    formatList("Constraints", input.constraints),
    formatList("Criteria to respect", input.criteria),
    formatIdeas(input.ideas)
  ].filter(Boolean);

  const userPrompt = sections.join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    temperature: 0.6,
    topP: 0.9,
    maxOutputTokens: 1100,
    schema: memoryThinkSupportClusteringOutputSchema
  };
}

function buildConvergencePrompt(input: MemoryThinkSupportInput): PromptConfig {
  const systemPrompt = `${BASE_SYSTEM_PROMPT}\nScore and prioritise the strongest ideas. Describe trade-offs and provide a crisp handoff summary.`;
  const sections = [
    `Phase: convergence`,
    `Topic: ${input.topic}`,
    formatEvaluationCriteria(input.evaluationCriteria),
    input.candidateIdeaIds?.length
      ? `Candidate idea IDs: ${input.candidateIdeaIds.join(", ")}`
      : "",
    formatCandidateClusters(input.candidateClusters),
    formatList("Human shortlist", input.humanShortlist),
    formatIdeas(input.ideas)
  ].filter(Boolean);

  const userPrompt = sections.join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    temperature: 0.3,
    topP: 0.8,
    maxOutputTokens: 1000,
    schema: memoryThinkSupportConvergenceOutputSchema
  };
}

function buildPromptConfig(input: MemoryThinkSupportInput): PromptConfig {
  switch (input.phase) {
    case "divergence":
      return buildDivergencePrompt(input);
    case "clustering":
      return buildClusteringPrompt(input);
    case "convergence":
      return buildConvergencePrompt(input);
    default:
      return buildDivergencePrompt(input);
  }
}

export type ThinkSupportRunner = (input: MemoryThinkSupportInput) => Promise<MemoryThinkSupportOutput>;

export function createThinkSupportRunner(env: EnvVars): ThinkSupportRunner {
  return async (input: MemoryThinkSupportInput) => {
    const parsed = memoryThinkSupportInputSchema.parse(input);
    const config = buildPromptConfig(parsed);

    const response = await generateStructuredChatCompletion(env, {
      systemPrompt: config.systemPrompt,
      userPrompt: config.userPrompt,
      temperature: config.temperature,
      topP: config.topP,
      maxOutputTokens: config.maxOutputTokens,
      schema: config.schema
    });

    return memoryThinkSupportOutputSchema.parse(response);
  };
}
