# Pipeline

## Agent Kit selection

The current managed subset, immutable source and update procedure are in [AGENT-KIT.md](AGENT-KIT.md). The manifest owns only those selected folders. The predecessor receipts and local adaptation notes below remain provenance for the other folders; an older whole-set sync recipe does not apply to the managed subset.


Predecessor copies came from the [pinned workspace pipeline](https://github.com/KirillSachkov/workspace/tree/979a7ec3ee9cf140efab613864c6f1803425547a/pipeline).
The Agent Kit subset follows its manifest; retained local folders keep the predecessor source and adaptations below.
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
