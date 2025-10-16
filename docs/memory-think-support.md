# memory-think-support Tool Design

## Purpose
- Provide the primary assistant with a lightweight co-pilot dedicated to structured brainstorming.
- Guide sessions through divergent, clustering, and convergent phases without forcing the host model to manage state manually.
- Leverage `gpt-5-nano` for fast, low-cost ideation while keeping the authoritative assistant in control of selection and refinement.

## Experience Goals
- Keep humans in the loop: surface why ideas were generated or grouped so the operator can make informed choices.
- Encourage breadth first, then focus: mirror the Design Council Double Diamond pattern (discover/develop, define/deliver).
- Make transitions obvious: every tool response should explain what just happened and propose the next move (continue, shift phase, or stop).
- Reduce repetition: track explored angles to avoid rehashing obvious ideas (address the "cliche machine" tendency noted in AI brainstorming research).

## Phased Workflow
### 1. Divergence (Idea Generation)
- Objective: explore wide solution space with high novelty.
- LLM config: `gpt-5-nano`, temperature 0.9, top-p 0.95, presence penalty 0.3 to push variety.
- Input expectations: `topic`, optional `constraints`, optional `seedAngles` provided by the host assistant or user.
- Output contract:
  - `ideas`: array of `{ id, title, summary, inspirationSource, riskNotes }`.
  - `coverage`: short narrative of explored angles vs. gaps.
  - `nextRecommendation`: usually "consider clustering" once idea count or diversity threshold reached.
- Guardrails: remind operator that quality varies; cite research that high fluency does not equal high value; prompt the operator to flag keeper ideas manually.

### 2. Clustering (Sense-making)
- Objective: organize divergent set into themes to prep convergence.
- LLM config: temperature 0.6, top-p 0.9 for balanced creativity and cohesion.
- Input expectations: `ideas` selected by the host (subset or full list), optional `criteria` (e.g., user persona, feasibility).
- Output contract:
  - `clusters`: array of `{ clusterId, label, rationale, memberIdeaIds, refinementPrompts }`.
  - `outliers`: ideas that did not fit clusters with hints for follow-up personas/analogies.
  - `nextRecommendation`: suggest moving to convergence or deepening a specific cluster.
- Guardrails: encourage mixing human insight and provide a slot to inject user-created tags so AI respects prior knowledge.

### 3. Convergence (Prioritization)
- Objective: score and highlight promising directions.
- LLM config: temperature 0.3, top-p 0.8 to emphasize clarity and grounded reasoning.
- Input expectations: `candidateClusters` or `candidateIdeaIds`, `evaluationCriteria` (value, novelty, effort), optional `humanShortlist` for bias correction.
- Output contract:
  - `rankedIdeas`: array of `{ ideaId, scoreBreakdown: { criterion: score }, overallRationale, nextSteps }`.
  - `tradeoffs`: explicit risks, assumptions, or validation tasks for each top idea.
  - `handoffSummary`: concise brief the host assistant can surface to the user.
- Guardrails: highlight hallucination risk; ask operator to validate facts before execution.

## Tool Interface
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "memory-think-support Input",
  "type": "object",
  "required": ["phase", "topic"],
  "properties": {
    "phase": {
      "type": "string",
      "enum": ["divergence", "clustering", "convergence"]
    },
    "topic": {
      "type": "string",
      "description": "Problem statement or prompt driving the session"
    },
    "constraints": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Hard requirements, e.g., budget, timeline, audience"
    },
    "seedAngles": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Starting perspectives or analogies to explore"
    },
    "ideas": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "title", "summary"],
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "summary": { "type": "string" },
          "metadata": {
            "type": "object",
            "description": "Optional model- or human-annotated fields"
          }
        }
      },
      "description": "Idea set carried between phases"
    },
    "evaluationCriteria": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "definition"],
        "properties": {
          "name": { "type": "string" },
          "definition": { "type": "string" },
          "weight": { "type": "number" }
        }
      }
    }
  },
  "additionalProperties": true
}
```

The server should route requests by `phase` to dedicated prompt templates while sharing conversation state through memory keys. Outputs should mirror the structures described in the workflow sections so the host assistant can plug them directly into UI affordances or follow-up prompts.

## Prompting Strategy
- Divergence template: stress quantity and diversity (e.g., "produce ideas that differ from each other in approach, audience, and risk level"). Encourage analogical jumps and persona-based riffs per research showing these techniques unlock novelty.
- Clustering template: request 3-6 themes, rationale sentences, and one follow-up prompt per cluster to continue ideation if needed.
- Convergence template: demand transparent scoring tables, call out assumptions requiring human validation, and suggest a lightweight experiment for the top choice.
- All templates should remind the model to keep responses terse (max 1500 tokens) and respect any human-provided tags or do-not-repeat lists.

## Integration Notes
- Server (`packages/server/src/index.ts`): add handler case invoking the appropriate prompt function based on `phase` and returning the structured payload.
- Shared schemas (`packages/shared/src/schemas.ts`): define `memoryThinkSupportInputSchema`/`OutputSchema` to keep stdio and server aligned.
- STDIO adapter (`packages/stdio/src/index.ts`): register the new tool with passthrough input schema and wire to HTTP endpoint.
- Tests: mirror the `think` tool tests with fixtures validating each phase response shape.
- Docs: link this design from `docs/implementation-plan.md` once code work begins.

## References
- Design Council Double Diamond: emphasizes alternating divergent and convergent phases for effective problem solving (Design Council, 2024).
- Yuji Isobe, "AI can supercharge divergent thinking": discusses temperature tuning, persona prompting, and human-in-the-loop safeguards for AI brainstorming (Medium, 2025).
