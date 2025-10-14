# Phase 1 Inference Workflow

Phase 1 introduces a lightweight workflow that packages the seeded Phase 0 data into an LLM-friendly bundle. The objective is to generate consistent prompts and capture the assistant's answers as new memos.

## Prompt Template

Use the following Markdown template when asking the LLM to reason about a pivot memo. Substitute the placeholders with live data from the Phase 1 workflow script.

```markdown
## Task
{{task_description}}

## Pivot Memo
- ID: {{pivot.memoId}}
- Title: {{pivot.title}}
- Summary: {{pivot.summary}}

## Related Memos (Similarity)
{{#each searchResults}}
- {{title}} ({{memoId}}) — similarity {{score}}
{{/each}}

## Relation Edges
{{#each relationEdges}}
- {{sourceTitle}} → {{targetTitle}} ({{tag}}, weight {{weight}}, depth {{depth}})
  - Path: {{path}}
  - Reason: {{reason}}
{{/each}}

## Guidance
- Respect supports/conflicts/explains tags when forming conclusions.
- Surface the most relevant evidence as quotes or bullet points.
- Note remaining risks or unknowns.
```

When additional structure is needed, render `searchResults` and `relationEdges` as JSON blocks instead of bullet lists. The handlebars-style braces indicate insertion points—feel free to adapt to any templating engine.

## Workflow Script

Run the helper to gather pivot search and relation graph payloads in one shot:

```bash
bun run scripts/phase1Workflow.ts -- \
  --pivot f6e10808-f937-4c35-b926-8a1769fbfd18 \
  --namespace phase0/workspace/reasoning \
  --k 5 \
  --depth 2 \
  --limit 50
```

Required environment variables:
- `MEMORY_HTTP_URL` — Cloudflare Worker endpoint, e.g. `https://mcp-memory-server.mako10k.workers.dev`
- `MEMORY_HTTP_BEARER_TOKEN` — API key generated during Phase 0 (`create:api-key` output)

Optional:
- `MEMORY_NAMESPACE_DEFAULT` — overrides the default namespace header if you omit `--namespace`
- `MEMORY_HTTP_TIMEOUT_MS` — abort long-running requests

The script prints a JSON summary:

```jsonc
{
  "pivot": "f6e10808-f937-4c35-b926-8a1769fbfd18",
  "namespace": "phase0/workspace/reasoning",
  "search": {
    "count": 4,
    "memoIds": [
      { "memoId": "8e134ab5-…", "title": "User Feedback Summary", "score": 0.349 },
      …
    ]
  },
  "graph": {
    "count": 5,
    "edges": [
      {
        "sourceMemoId": "f6e10808-…",
        "targetMemoId": "8e134ab5-…",
        "tag": "explains",
        "weight": 0.7,
        "direction": "forward",
        "depth": 1,
        "path": ["f6e10808-…", "8e134ab5-…"]
      }
    ],
    "nodes": [
      { "memoId": "f6e10808-…", "title": "Inference Dataset Overview" },
      …
    ]
  }
}
```

Feed the data into the prompt template or serialize it for client-side consumption.

## Capturing LLM Responses

After the LLM produces a draft, store it using `memory.save` so future phases can reuse the outcome. Suggested metadata:

```jsonc
{
  "category": "inference-output",
  "phase": "1",
  "pivotMemoId": "f6e10808-f937-4c35-b926-8a1769fbfd18",
  "source": "phase1-template",
  "tags": ["answer", "phase1"]
}
```

Example CLI call (replace the bearer token and namespace as needed):

```bash
curl -sS -X POST "$MEMORY_HTTP_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MEMORY_HTTP_BEARER_TOKEN" \
  -d '{
    "tool": "memory.save",
    "params": {
      "namespace": "phase0/workspace/inference",
      "title": "Answer: latency mitigation plan",
      "content": "<LLM draft>",
      "metadata": {
        "category": "inference-output",
        "phase": "1",
        "pivotMemoId": "f6e10808-f937-4c35-b926-8a1769fbfd18",
        "source": "phase1-template",
        "tags": ["answer", "phase1"]
      }
    }
  }'
```

Storing results under a separate namespace such as `phase0/workspace/inference` keeps input memos distinct from generated outputs. Use the relation tools to link answers back to evidence memos for traceability.
