# Phase 4 Automation & Sync

Phase 4 wraps the previous workflows in automation primitives, enabling repeatable runs, scheduled re-evaluation, and data exports for visualization or downstream tools.

## Orchestration CLI

Use the automation helper to process one or more pivot memos in a single run:

```bash
bun run scripts/phase4Automation.ts -- \
  --pivot f6e10808-f937-4c35-b926-8a1769fbfd18 \
  --pivot 8e134ab5-de6b-4821-b0f0-f5541dd93ca2 \
  --namespace phase0/workspace/reasoning \
  --tag supports \
  --output reports/phase4-supports.json
```

Options:
- `--pivots-file <path>`: JSON array of memo IDs (e.g., from a cron job or dashboard).
- `--similarity-weight`, `--relation-weight`, `--min-combined`: reuse the scoring knobs from Phase 2.
- `--output <path>`: write the consolidated report to disk for archival or further processing.

The script emits a JSON payload containing:
- Run metadata (`generatedAt`, weights, tag filter).
- Per-pivot evidence arrays (positives/conflicts/others) ready for templating or dashboards.

## Scheduled Re-evaluation

Batch the workflow using cron (pm2) or Cloudflare Queues:

```bash
# cron example: run every morning at 06:15 UTC
15 6 * * * cd /home/mako10k/mcp-memo && \
  MEMORY_HTTP_URL=... \
  MEMORY_HTTP_BEARER_TOKEN=... \
  bun run scripts/phase4Automation.ts -- \
    --pivots-file configs/priority-pivots.json \
    --namespace phase0/workspace/reasoning \
    --output reports/nightly-phase4.json >> logs/phase4-cron.log 2>&1
```

Maintain `configs/priority-pivots.json` as a simple list of memo IDs that should be re-scored regularly. The output can be diffed to catch regressions or exported to monitoring tools.

## External Graph Sync (PoC)

The automation output is already graph-friendly. Pipe it through a formatter to build CSV/JSON for external platforms (e.g., Memgraph, Neo4j, Observable):

```bash
bun run scripts/phase4Automation.ts -- \
  --pivot f6e10808-f937-4c35-b926-8a1769fbfd18 \
  --namespace phase0/workspace/reasoning \
  --output exports/phase4-report.json

bun run scripts/exportGraph.ts -- \
  --input exports/phase4-report.json \
  --format csv \
  --output exports/phase4-graph.csv
```

The `scripts/exportGraph.ts` stub is left to the integrator—structure is already aligned:

```jsonc
{
  "pivot": "f6e10808-…",
  "evidence": [
    {
      "memoId": "8e134ab5-…",
      "combined": 0.45,
      "bestEdge": {
        "tag": "supports",
        "weight": 0.65,
        "path": ["f6e10808-…", "8e134ab5-…", "65eaa58d-…"]
      }
    }
  ]
}
```

Each `bestEdge` already contains direction, weight, and path details required for graph exports.

## UI Hooks

- Feed the automation output into a dashboard (Superset, Grafana) by pointing it at the generated JSON file or Cloudflare R2 bucket.
- Expose the CLI via a thin HTTP wrapper (Cloudflare Worker or Bun service) to trigger refreshes from a web UI.
- Collect `phase3Feedback` results in the same report directory to track which suggestions were applied automatically.

## Checklist

- [x] CLI orchestrator for multi-pivot runs (`scripts/phase4Automation.ts`).
- [x] Cron/scheduler guidance for periodic scoring.
- [x] Export-ready JSON schema documented for graph synchronization.

With these pieces in place the inference pipeline can run unattended, closing the loop from data seeding through relation maintenance.
