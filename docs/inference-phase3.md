# Phase 3 Feedback Loop

Phase 3 introduces a feedback cycle that filters relation tags, captures new links from LLM answers, and retries reasoning with alternate pivots when evidence is weak. This layer helps maintain graph quality while iterating quickly on inference prompts.

## Tag-Focused Exploration

Use the relation graph filter to limit traversal to a specific tag before presenting evidence to the LLM:

```bash
bun run scripts/phase2Scoring.ts -- \
  --pivot f6e10808-f937-4c35-b926-8a1769fbfd18 \
  --namespace phase0/workspace/reasoning \
  --tag supports \
  --similarity-weight 0.5 \
  --relation-weight 0.5
```

Passing `--tag supports` (or `conflicts`, `explains`) narrows the graph query and ensures the LLM focuses on the desired relation type. Combine with `--min-combined` to drop low-confidence edges and `--direction forward` to avoid backtracking when crafting recommendations.

## Capturing New Relations from Answers

After the LLM returns a structured response (Phase 2 template), feed it into the feedback helper:

```bash
bun run scripts/phase3Feedback.ts -- \
  --pivot f6e10808-f937-4c35-b926-8a1769fbfd18 \
  --namespace phase0/workspace/inference \
  --input answer.json
```

- Without `--apply`, the script prints a JSON array of suggested relations (`supports` / `explains` / `conflicts`) extracted from the answer’s `evidence` and `conflicts` fields. Each suggestion includes a reason built from the model’s statement/quote.
- Add `--apply` to call `memory.relation.save` automatically. Configure `MEMORY_HTTP_URL` and `MEMORY_HTTP_BEARER_TOKEN` before running.
- Use `--default-weight` to set a fallback weight when the answer lacks confidence scores.

Example suggestion output:

```jsonc
{
  "pivot": "f6e10808-…",
  "namespace": "phase0/workspace/inference",
  "suggestions": [
    {
      "sourceMemoId": "8e134ab5-…",
      "targetMemoId": "f6e10808-…",
      "tag": "supports",
      "weight": 0.72,
      "reason": "Customer interviews report slow follow-ups. Users need faster confirmation that retrieved knowledge is relevant."
    }
  ]
}
```

Review the suggestions, adjust the reason or weight if needed, and re-run with `--apply` to persist the links.

## Pivot Retry Strategy

When the combined score from Phase 2 falls below a threshold (e.g., `confidence < 0.4`), switch the pivot to a higher-scoring memo and rerun the workflow:

1. Identify the top candidate from `prioritizedEvidence`.
2. Rerun Phase 1 / Phase 2 commands with `--pivot <candidateMemoId>`.
3. Compare the resulting conclusions; keep the better-supported answer.

Document retries by saving each attempt in `phase0/workspace/inference` with metadata:

```jsonc
{
  "category": "inference-output",
  "phase": "3",
  "pivotMemoId": "<original-pivot>",
  "retryPivotId": "<alternate-pivot>",
  "retryReason": "Low combined confidence (0.35)",
  "tags": ["answer", "phase3", "retry"]
}
```

Track recurring retries to discover areas where additional source material or relations are needed.

## Summary Checklist

- Apply `--tag` filters to focus on relevant relation types before prompting.
- Convert structured answers into relation updates using `scripts/phase3Feedback.ts`.
- Retry with alternate pivots when combined confidence is low and record the outcome.

These steps close the loop between evidence generation and graph maintenance, preparing the way for Phase 4 automation.
