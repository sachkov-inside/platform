# Pipeline

Copies from the [workspace pipeline](https://github.com/KirillSachkov/workspace/tree/main/pipeline),
installed through workspace `sync-pipeline` (Project set). Keep each copy identical to its source.
Project rules live in `docs/agents/`, not in skill directories.

## Source

- Workspace `979a7ec3ee9cf140efab613864c6f1803425547a` (2026-10-31, decisions 197 to 199),
  upstream sync `a496f5513d4a4cf889bc48e189e579f4b0bdf6aa`. Platform: [#1915](https://github.com/sachkov-inside/platform/issues/1915).
- Pre-update Platform commit: `84fc614ed0542370c88dfed7fcf5d5913a892063`. Git history keeps
  earlier sources, `classify-change` and the review receipt.

## Set

`code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `grill-with-docs`,
`grilling`, `handoff`, `implement`, `implement-spec`, `improve-codebase-architecture`, `pr`,
`prototype`, `research`, `retro`, `setup-matt-pocock-skills`, `ship`, `tdd`, `to-questionnaire`,
`to-spec`, `to-tickets`, `triage`, `wait-what`, `wayfinder`, `wizard`, `writing-for-agents`.

`ask-matt`, `grill-me` and `teach` stay out by owner decision 3 of #1674.

## Project rules for skills

- `ship`: [ship](../../docs/agents/ship.md). `pr`: [pr](../../docs/agents/pr.md).
- `prototype`: [frontend delivery](../../docs/agents/frontend-delivery.md#prototypes).
- `to-spec`, `to-tickets`, `triage`: [triage labels](../../docs/agents/triage-labels.md).
- `implement-spec`: [coordinated execution](../../docs/agents/coordinated-execution.md).
- `retro`: [owner corrections](../../docs/agents/owner-corrections.md).

## Outside the pipeline

Maintained in Platform: `impeccable`, `vercel-react-best-practices`, `modern-web-guidance`,
`playwright-cli` (frontend set), `session-cleanup` and `local-stand`.
