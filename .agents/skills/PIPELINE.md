# Pipeline

Owner-selected copies from the [workspace pipeline](https://github.com/KirillSachkov/workspace/tree/main/pipeline).
Keep installed copies identical to their recorded workspace source, including approved shared adaptations.
Project overrides belong in `WORKFLOW.md` and `AGENTS.md`.
Use `sync-pipeline` for assigned updates.

## Source versions

- Complete-set baseline: workspace `a1233e8`, upstream `dd400c3ad65e57c06f05e832e0aac92c7992f34d`.
- `tdd` and its supporting files: workspace `b69d91f48067f0817e88cce7da7399207bdc2003`; its shared adaptation remains unchanged.
- `ask-matt` and its Codex metadata: workspace `dcd7d919e7b1011ffaad8c9f2e897d7b8cdc5544`.
  Its `SKILL.md` retains upstream bytes from `49dd158d1076134a641b33efb035946536778336`.
- `classify-change`, `implement`, `implement-spec`, `code-review`, and `setup-matt-pocock-skills`,
  including supporting files and metadata: workspace `8e4a447811beca8a77d97dba2824ab71988ef8f5`.
  The owner-approved adaptation adds classification, behavioral review, finding convergence and risk-policy onboarding.
  `classify-change` is locally authored. This selective adoption does not update unrelated upstream skills.
- Manual skills retain `agents/openai.yaml` with `policy.allow_implicit_invocation: false`.
  `pnpm docs:check` checks that policy for skills marked `disable-model-invocation: true`.

The custom coordination companion was removed under #1423. The installed `implement-spec` stands alone;
project coordination, per-ticket review and final integrated review are defined in `WORKFLOW.md`.

## Set

- ask-matt
- classify-change
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

## Adoption and recovery

Accepted specification: [workspace#57](https://github.com/KirillSachkov/workspace/issues/57).
Shared delivery: [workspace#60](https://github.com/KirillSachkov/workspace/pull/60).
Platform adoption: [#1524](https://github.com/sachkov-inside/platform/issues/1524),
[PR #1525](https://github.com/sachkov-inside/platform/pull/1525).
The pre-adoption Platform commit is `802f789f811b7804e4362845e6dafa81836ac9bb`;
the pre-adaptation shared source is `0fab3ec6cd5039c64220fce85dfb28cf2e0cd6e5`.

The installed source and project policy/workflow together identify the active behavior.
Use the adoption PR's merged commit to identify the project policy version, and its evidence to
locate the fixed local evaluations in workspace. Source identity alone does not prove evaluation success.

For rollback, prepare a selective reverse patch of the adoption against its recorded Platform base.
Include the adopted skill directories, project policy, workflow/routing, provenance and changed documentation checks.
Run `git apply --reverse --check` before applying the reviewed patch; resolve later conflicts explicitly.
Pass `pnpm docs:check` and affected tooling checks, then record the restored identities in the task/PR.
Preserve unrelated product changes and recheck in-flight assignments against the restored rules.
This procedure restores harness behavior; it does not undo product merges, deployments or data changes.
