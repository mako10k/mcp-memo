# Phase 0 Inference Dataset

## Overview
The Phase 0 checklist now has a concrete memo graph seeded in the namespace `phase0/workspace/reasoning`. The goal is to exercise pivot-based retrieval and relation traversal before building higher-level inference workflows.

## Access Context
- Root namespace: `phase0`
- Default namespace: `phase0/workspace`
- Seeded sub-namespace: `phase0/workspace/reasoning`
- Owner ID: `35f5cf8e-d5db-4b62-9642-abb234f904dc`

> The bearer token printed during `bun run --cwd packages/server create:api-key` is **not** checked into the repository. Store it in Secret Manager or a local .env file when invoking the worker.

## Memo Seed
| Title | Memo ID | Category | Author | Tags |
| --- | --- | --- | --- | --- |
| Inference Dataset Overview | f6e10808-f937-4c35-b926-8a1769fbfd18 | context | phase0-bot | overview, phase0 |
| User Feedback Summary | 8e134ab5-de6b-4821-b0f0-f5541dd93ca2 | research | insights-team | feedback, latency |
| Design Decision: Pivot Search | e7dfe203-f948-4dd8-90da-c348f4fcc2b4 | architecture | platform-arch | pivot, design-decision |
| Risk: Missing Evidence | 65eaa58d-a595-48ca-93c8-b182bdc42ae0 | risk | qa-lead | risk, evidence |
| Evidence: Latency Metrics | a9a59df1-743e-4ba8-80a1-0ddfdd383e94 | evidence | analytics | latency, metrics |

All seed memos include the common metadata keys `category`, `author`, `phase`, and `tags` for future filter experiments.

## Relation Seed
| Source → Target | Tag | Weight | Reason |
| --- | --- | --- | --- |
| Design Decision: Pivot Search → Inference Dataset Overview | supports | 0.8 | Pivot retrieval keeps the experiment scoped to relevant anchors. |
| Evidence: Latency Metrics → User Feedback Summary | supports | 0.9 | Latency numbers quantify the reported pain. |
| Risk: Missing Evidence → Inference Dataset Overview | conflicts | 0.6 | Overview lacks explicit evidence links today. |
| Inference Dataset Overview → User Feedback Summary | explains | 0.7 | Overview documents why the interviews were triggered. |
| User Feedback Summary → Risk: Missing Evidence | supports | 0.65 | Interviews highlight the need for reliable evidence trails. |

## Verification Notes
- **Pivot search**: `memory.search` with pivot `f6e10808-f937-4c35-b926-8a1769fbfd18` returns the four related memos above with cosine similarity scores between 0.33 and 0.49, confirming the embedding and exclusion logic works.
- **Relation graph**: `memory.relation.graph` with `direction="both"` and `maxDepth=2` surfaces the five edges above and returns the expected path arrays, proving traversal and depth handling are correct for the seeded namespace.

## Tagging Rules
- `supports`: Use for evidence, decisions, or feedback that positively reinforce the target memo. Set weight between 0.6 and 1.0 depending on confidence.
- `conflicts`: Use when a memo calls out gaps, risks, or contradictions. Set weight between 0.4 and 0.8 and explain the conflict in one sentence.
- `explains`: Use when a memo provides clarifying context. Set weight between 0.5 and 0.8 and focus the reason on the narrative bridge.

Always provide the `reason` field in plain language so downstream prompts can surface it as a justification snippet.
