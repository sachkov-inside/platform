# Pipeline

Owner-selected copies from the [workspace pipeline](https://github.com/KirillSachkov/workspace/tree/main/pipeline).
Keep installed copies identical to their recorded workspace source, including approved shared adaptations.
Project overrides belong in `WORKFLOW.md` and `AGENTS.md`.
For assigned updates, copy only the selected skill directories and metadata from the pinned
workspace source and record their exact commit here. `sync-pipeline` is not installed in Platform.

## Source versions

- Complete-set baseline: workspace `a1233e8`, upstream `dd400c3ad65e57c06f05e832e0aac92c7992f34d`.
- `ask-matt` and its Codex metadata: workspace `dcd7d919e7b1011ffaad8c9f2e897d7b8cdc5544`.
  Its `SKILL.md` retains upstream bytes from `49dd158d1076134a641b33efb035946536778336`.
- `classify-change`, `implement`, `implement-spec`, `code-review`, `tdd`, and
  `setup-matt-pocock-skills`, including supporting files and metadata: workspace
  `d459183f46290ef74ede4f3eca349ab0682cbd0c`.
  This selective cleanup adopts workflow-only classification routing and canonical AGENTS setup.
  Risk/participation reasoning and review mechanics are unchanged from the accepted adaptation.
- `implement-spec/SKILL.md` only: workspace `0017667f4e7beb5e3b6f8428ae21441496cdfec9` (#1534).
  SHA-256: `f6219d1993fa443122fef8748a09e085038895233b7d5dfbe7bdad4b2509927d`.
  This supersedes that file's earlier source above; all other installed skill bytes and native
  manual metadata remain unchanged. The source [harness contract](https://github.com/KirillSachkov/workspace/blob/0017667f4e7beb5e3b6f8428ae21441496cdfec9/docs/harness-workflow.md)
  and [pipeline record](https://github.com/KirillSachkov/workspace/blob/0017667f4e7beb5e3b6f8428ae21441496cdfec9/pipeline/README.md)
  define the shared adaptation; reachable local routing and exceptions live in `WORKFLOW.md`.
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
  `modern-web-guidance` uses its checked-in guide corpus for focused compatibility questions.
- `session-cleanup`: Platform-owned skill; maintained in Platform.

## Adoption and recovery

Accepted specification: [workspace#57](https://github.com/KirillSachkov/workspace/issues/57).
Shared delivery: [workspace#60](https://github.com/KirillSachkov/workspace/pull/60).
Platform adoption: [#1524](https://github.com/sachkov-inside/platform/issues/1524),
[PR #1525](https://github.com/sachkov-inside/platform/pull/1525).
The pre-adoption Platform commit is `802f789f811b7804e4362845e6dafa81836ac9bb`;
the pre-adaptation shared source is `0fab3ec6cd5039c64220fce85dfb28cf2e0cd6e5`.

Cleanup #1528 starts from Platform `74045824e964f336e96b6498e1dbef7799333619`.
The four legacy CLAUDE files contained only `@AGENTS.md`; no unique instructions were removed.
The owner-confirmed Claude Code 2.1.301 native AGENTS support and enabled fallback permit removal.
The existing enabled classification policy from #1524 remains in WORKFLOW.md.

The installed source and project policy/workflow together identify the active behavior.
Use the adoption PR's merged commit to identify the project policy version, and its evidence to
locate the fixed local evaluations in workspace. Source identity alone does not prove evaluation success.

For rollback, prepare a selective reverse patch of the adoption against its recorded Platform base.
Include the adopted skill directories, project policy, workflow/routing, provenance and changed documentation checks.
Run `git apply --reverse --check` before applying the reviewed patch; resolve later conflicts explicitly.
Pass `pnpm docs:check` and affected tooling checks, then record the restored identities in the task/PR.
Preserve unrelated product changes and recheck in-flight assignments against the restored rules.
This procedure restores harness behavior; it does not undo product merges, deployments or data changes.
