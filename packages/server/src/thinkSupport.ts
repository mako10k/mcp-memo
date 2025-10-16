import {
  memoryThinkSupportInputSchema,
  memoryThinkSupportOutputSchema,
  memoryThinkSupportDivergenceOutputJsonSchema,
  memoryThinkSupportClusteringOutputJsonSchema,
  memoryThinkSupportConvergenceOutputJsonSchema,
  type MemoryThinkSupportInput,
  type MemoryThinkSupportOutput
} from "./schemas";
import { generateStructuredChatCompletion } from "./openai";
import type { EnvVars } from "./env";

const BASE_SYSTEM_PROMPT = `You are an AI brainstorming facilitator that supports a primary assistant.
Always return concise JSON without markdown. Keep text within each field short and practical.
Use the provided schema exactly and avoid adding unexpected keys.
Schema requirements by phase:
- divergence: include phase, ideas (>=1), coverage, nextRecommendation, warnings (optional)
- clustering: include phase, clusters (>=1), outliers (optional), nextRecommendation, warnings (optional)
- convergence: include phase, rankedIdeas (>=1), handoffSummary, nextRecommendation, tradeoffs (optional), warnings (optional)
Respond by emitting a single function call named "memory_think_support" containing the JSON payload.`;

const STRUCTURED_TOOL_NAME = "memory_think_support";
const STRUCTURED_TOOL_DESCRIPTION =
  "Return the structured brainstorming support payload for memory.think.support.";

interface PromptConfig {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  schema: typeof memoryThinkSupportOutputSchema;
  jsonSchema: Record<string, unknown>;
  toolName: string;
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
    temperature: 1,
    topP: 1,
    maxOutputTokens: 1200,
    schema: memoryThinkSupportOutputSchema,
    jsonSchema: memoryThinkSupportDivergenceOutputJsonSchema,
    toolName: `${STRUCTURED_TOOL_NAME}_divergence`
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
    temperature: 1,
    topP: 1,
    maxOutputTokens: 1000,
    schema: memoryThinkSupportOutputSchema,
    jsonSchema: memoryThinkSupportClusteringOutputJsonSchema,
    toolName: `${STRUCTURED_TOOL_NAME}_clustering`
  };
}

function buildConvergencePrompt(input: MemoryThinkSupportInput): PromptConfig {
  const systemPrompt = `${BASE_SYSTEM_PROMPT}\nScore and prioritise the strongest ideas. For each ranked idea you MUST include a scoreBreakdown object keyed by evaluation criteria with numeric scores, and describe trade-offs. Provide a crisp handoff summary plus a single nextRecommendation string. Never omit scoreBreakdown even when uncertain; provide best-effort numeric estimates.`;
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

  if (input.evaluationCriteria?.length) {
    const criteriaNames = input.evaluationCriteria.map((criterion) => criterion.name).join(", ");
    sections.push(
      `Scoring requirements: Provide scoreBreakdown objects with numeric scores (0-5) for each criterion (${criteriaNames}).`
    );
  } else {
    sections.push("Scoring requirements: Provide scoreBreakdown objects with numeric scores (0-5) for each evaluation criterion.");
  }

  const scoreExample = input.evaluationCriteria?.length
    ? input.evaluationCriteria.reduce<Record<string, number>>((acc, criterion) => {
        acc[criterion.name] = 4;
        return acc;
      }, {})
    : { "Example Criterion": 4 };

  sections.push(
    "Structured response template:",
    JSON.stringify(
      {
        phase: "convergence",
        rankedIdeas: [
          {
            ideaId: "<exact ideaId>",
            scoreBreakdown: scoreExample,
            overallRationale: "<succinct rationale>",
            nextSteps: ["<action 1>", "<action 2>"]
          }
        ],
        handoffSummary: "<summary>",
        nextRecommendation: "<single recommendation>",
        tradeoffs: [
          {
            ideaId: "<exact ideaId>",
            risks: ["<optional risk>"],
            assumptions: ["<optional assumption>"],
            validationTasks: ["<optional task>"]
          }
        ],
        warnings: ["<optional warning>"]
      },
      null,
      2
    ),
    "The scoreBreakdown object is REQUIRED and must include every evaluation criterion name as a key with a numeric value between 0 and 5."
  );

  const userPrompt = sections.join("\n\n");

  return {
    systemPrompt,
    userPrompt,
    temperature: 1,
    topP: 1,
    maxOutputTokens: 900,
    schema: memoryThinkSupportOutputSchema,
    jsonSchema: memoryThinkSupportConvergenceOutputJsonSchema,
    toolName: `${STRUCTURED_TOOL_NAME}_convergence`
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

    try {
      const response = await generateStructuredChatCompletion(env, {
        systemPrompt: config.systemPrompt,
        userPrompt: config.userPrompt,
        temperature: config.temperature,
        topP: config.topP,
        maxOutputTokens: config.maxOutputTokens,
        schema: config.schema,
        jsonSchema: config.jsonSchema,
        toolName: config.toolName,
        toolDescription: STRUCTURED_TOOL_DESCRIPTION,
        reasoningEffort: "minimal"
      });

      return memoryThinkSupportOutputSchema.parse(response);
    } catch (error) {
      const repaired = attemptConvergenceRepair(error, parsed, config.schema);
      if (repaired) {
        return repaired;
      }
      throw error;
    }
  };
}

function attemptConvergenceRepair(
  error: unknown,
  input: MemoryThinkSupportInput,
  schema: typeof memoryThinkSupportOutputSchema
): MemoryThinkSupportOutput | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const marker = "| payload=";
  const markerIndex = error.message.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const raw = error.message.slice(markerIndex + marker.length).trim();
  if (!raw) {
    return null;
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsedPayload || typeof parsedPayload !== "object") {
    return null;
  }

  const payload = { ...(parsedPayload as Record<string, unknown>) };
  if (payload.phase !== "convergence") {
    return null;
  }

  const rankedIdeas = Array.isArray(payload.rankedIdeas) ? [...payload.rankedIdeas] : [];
  if (!rankedIdeas.length) {
    return null;
  }

  const criteriaNames = input.evaluationCriteria?.map((criterion) => criterion.name) ?? [];
  const defaultScoreNames = criteriaNames.length ? criteriaNames : ["Overall"];

  const repairedRankedIdeas = rankedIdeas.map((idea) => {
    if (!idea || typeof idea !== "object") {
      return idea;
    }

    const ideaRecord = { ...(idea as Record<string, unknown>) };
    const existingBreakdown = ideaRecord.scoreBreakdown;
    if (!existingBreakdown || typeof existingBreakdown !== "object") {
      const fallbackScores: Record<string, number> = {};
      defaultScoreNames.forEach((name) => {
        fallbackScores[name] = 3;
      });
      ideaRecord.scoreBreakdown = fallbackScores;
    }

    return ideaRecord;
  });

  const repairedPayload = {
    ...payload,
    rankedIdeas: repairedRankedIdeas
  };

  try {
    return schema.parse(repairedPayload);
  } catch {
    return null;
  }
}
