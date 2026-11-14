# Pipeline

The 25 existing common engineering skills are selected pinned Agent Kit copies. See
[AGENT-KIT.md](AGENT-KIT.md) for the source, complete selection and update procedure.
The manifest and lock own installation; project rules live in root AGENTS.md and docs/agents.

## Project rules

- `implement`, `tdd`, `code-review`: [implementation](../../docs/agents/implementation.md).
- `ship`: [ship](../../docs/agents/ship.md). `pr`: [PR body](../../docs/agents/pr.md).
- `prototype`: [frontend delivery](../../docs/agents/frontend-delivery.md#prototypes).
- `to-spec`, `to-tickets`, `triage`: [triage labels](../../docs/agents/triage-labels.md).
- `implement-spec`: [coordinated execution](../../docs/agents/coordinated-execution.md).
- `retro`: [owner corrections](../../docs/agents/owner-corrections.md).

## Provenance and exclusions

Before normalization, project variants came from workspace
`979a7ec3ee9cf140efab613864c6f1803425547a`, upstream
`a496f5513d4a4cf889bc48e189e579f4b0bdf6aa`, recorded in
[#1915](https://github.com/sachkov-inside/platform/issues/1915).
Git history at the migration base in AGENT-KIT.md preserves the adaptations.

Owner decision 3 of #1674 excluded `ask-matt`, `grill-me` and `teach`.
Agent Kit renamed `ask-matt` to `ask`; `ask` stays excluded under that same decision.
No installed procedure calls the excluded name or requires an `ask` alias.

## Outside the pipeline

Platform retains `ai-models-refresh`, `impeccable`, `vercel-react-best-practices`,
`modern-web-guidance`, `playwright-cli`, `session-cleanup` and `local-stand`.
