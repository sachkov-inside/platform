# Pipeline

Owner-selected copies from the [workspace pipeline](https://github.com/KirillSachkov/workspace/tree/main/pipeline).
Keep upstream skill bodies unchanged; project overrides belong in `WORKFLOW.md` and `AGENTS.md`.
Use `sync-pipeline` for assigned updates.

## Source versions

- Complete-set baseline: workspace `a1233e8`, upstream `dd400c3ad65e57c06f05e832e0aac92c7992f34d`.
- `tdd` and its supporting files: workspace `b69d91f48067f0817e88cce7da7399207bdc2003`; its shared adaptation remains unchanged.
- `implement-spec`, `ask-matt` and their Codex metadata: workspace `dcd7d919e7b1011ffaad8c9f2e897d7b8cdc5544`.
  Their `SKILL.md` files are original upstream bytes from `49dd158d1076134a641b33efb035946536778336`.
  This selective restoration is not a complete-set upstream sync.
- Manual skills retain `agents/openai.yaml` with `policy.allow_implicit_invocation: false`.
  `pnpm docs:check` checks that policy for skills marked `disable-model-invocation: true`.

The custom coordination companion was removed under #1423. Original `implement-spec` stands alone;
project coordination, per-ticket review and final integrated review are defined in `WORKFLOW.md`.

## Set

- ask-matt
- code-review
- codebase-design
- diagnosing-bugs
- domain-modeling
- grill-me
- grill-with-docs
- grilling
- handoff
- implement
- implement-spec
- improve-codebase-architecture
- pr
- prototype
- research
- retro
- setup-matt-pocock-skills
- tdd
- teach
- to-questionnaire
- to-spec
- to-tickets
- triage
- wait-what
- wayfinder
- wizard
- writing-for-agents

## Outside the pipeline

- `impeccable`, `vercel-react-best-practices`, `modern-web-guidance`, `playwright-cli`:
  Platform's frontend set, installed with the 2026-08-19 harness; maintained in Platform.
- `karpathy-guidelines`: maintained in Platform until its rules move to the device profile.
- `session-cleanup`: Platform-owned skill; maintained in Platform.
