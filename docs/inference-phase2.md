# Phase 2 Evidence Scoring

Phase 2 layers scoring logic on top of the Phase 1 workflow so the LLM can prioritize evidence and report confidence. The goal is to combine similarity scores with relation weights, surface conflict edges explicitly, and standardize the output template (conclusion + evidence + confidence).

## Combined Score Formula

Set the weighting factors via CLI flags (defaults shown below):

- Similarity weight `α` (default `0.6`)
- Relation weight `β` (default `0.4`)

For each memo `m` (excluding the pivot):

```
similarity = clamp_01(memory.search.score)
relation   = clamp_01(best_relation.weight)
combined   = (α * similarity + β * relation) / (α + β)
```

The helper keeps the highest-weight relation per memo (based on the shortest path returned by `memory.relation.graph`). Use `--min-combined` to discard low-confidence candidates.

## Workflow Helper

```bash
bun run scripts/phase2Scoring.ts -- \
  --pivot f6e10808-f937-4c35-b926-8a1769fbfd18 \
  --namespace phase0/workspace/reasoning \
  --k 6 \
  --depth 2 \
  --limit 80 \
  --similarity-weight 0.6 \
  --relation-weight 0.4 \
  --min-combined 0.2
```

Environment variables (same as Phase 1):

- `MEMORY_HTTP_URL`
- `MEMORY_HTTP_BEARER_TOKEN`
- `MEMORY_NAMESPACE_DEFAULT` (optional)
- `MEMORY_HTTP_TIMEOUT_MS` (optional)

### Output Structure

```jsonc
{
  "pivot": "f6e10808-…",
  "namespace": "phase0/workspace/reasoning",
  "weights": { "similarity": 0.6, "relation": 0.4 },
  "thresholds": { "minCombined": 0.2 },
  "prioritizedEvidence": [
    {
      "memoId": "8e134ab5-…",
      "title": "User Feedback Summary",
      "similarity": 0.349,
      "relationWeight": 0.65,
      "combined": 0.456,
      "bestEdge": {
        "tag": "supports",
        "weight": 0.65,
        "direction": "forward",
        "depth": 2,
        "path": ["f6e10808-…", "8e134ab5-…", "65eaa58d-…"],
        "pathTitles": "Inference Dataset Overview -> User Feedback Summary -> Risk: Missing Evidence",
        "reason": "Customer interviews motivate tracking evidence quality to avoid hallucinations."
      }
    }
  ],
  "conflictingEvidence": [
    {
      "memoId": "65eaa58d-…",
      "title": "Risk: Missing Evidence",
      "combined": 0.39,
      "bestEdge": {
        "tag": "conflicts",
        "weight": 0.6,
        "pathTitles": "Inference Dataset Overview -> Risk: Missing Evidence"
      }
    }
  ],
  "otherRelations": []
}
```

Use `prioritizedEvidence` when citing supportive material and `conflictingEvidence` to highlight known risks. `pathTitles` is preformatted to show the chain of memos behind an edge.

## Response Template

Ask the LLM to produce structured answers following this JSON schema:

```jsonc
{
  "conclusion": "<1–2 sentences summarising the answer>",
  "evidence": [
    {
      "memoId": "8e134ab5-…",
      "statement": "Customer interviews report slow follow-ups.",
      "support": "supports",
      "quote": "Users need faster confirmation that retrieved knowledge is relevant.",
      "confidence": 0.7
    }
  ],
  "conflicts": [
    {
      "memoId": "65eaa58d-…",
      "risk": "Hallucinated rationales",
      "mitigation": "Capture explicit evidence links."
    }
  ],
  "confidence": 0.68,
  "nextSteps": [
    "Instrument evidence capture before rollout"
  ]
}
```

- Populate `confidence` using the weighted combination from the helper.
- Encourage the model to cite `pathTitles` when referencing multi-hop relations.
- Maintain numeric `confidence` within `[0,1]` and align individual evidence `confidence` with the memo’s `combined` score.

## Persisting Outputs

Continue to store answers via `memory.save`, reusing the Phase 1 metadata but tagging Phase 2 iterations:

```jsonc
{
  "category": "inference-output",
  "phase": "2",
  "pivotMemoId": "f6e10808-f937-4c35-b926-8a1769fbfd18",
  "source": "phase2-scoring",
  "tags": ["answer", "phase2"]
}
```

When the model produces notable counter-evidence, add relations with `memory.relation.save` (e.g., `conflicts` or `explains`) so the graph keeps evolving.

## Next Steps Toward Phase 3

- Monitor combined scores to calibrate the weighting factors.
- Capture failed prompts and adjust `--min-combined` to control noise.
- Identify recurring conflict edges; they will inform the feedback loop planned for Phase 3.
