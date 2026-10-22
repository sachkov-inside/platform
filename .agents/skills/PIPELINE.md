# Pipeline

Owner-selected copies from the [workspace pipeline](https://github.com/KirillSachkov/workspace/tree/main/pipeline).
Keep installed copies identical to their recorded workspace source, including approved shared adaptations.
Project overrides belong in `WORKFLOW.md` (Skill exceptions), `docs/agents/coordinated-execution.md` and
`docs/agents/change-risk.md`.
For assigned updates, copy only the selected skill directories and metadata from the pinned
workspace source and record their exact commit here. `sync-pipeline` is not installed in Platform.

## Source versions

- Complete-set baseline: workspace `a1233e8`, upstream `dd400c3ad65e57c06f05e832e0aac92c7992f34d`.
- `classify-change`, `code-review`, `tdd`, and `setup-matt-pocock-skills`, including supporting
  files and metadata: workspace `d459183f46290ef74ede4f3eca349ab0682cbd0c`.
  This selective cleanup adopts workflow-only classification routing and canonical AGENTS setup.
  Risk/participation reasoning and review mechanics are unchanged from the accepted adaptation.
- `implement` and `implement-spec`, whole directories with metadata: workspace
  `a0d172d1cd9efd9f4b7f382501d04b5961ac416d` (workspace #68), read from workspace `origin/main`
  `983e8aa8050bf97bf9b6c7c6652a1382b3cc0665` where both directories are unchanged (#1675).
  Both skills are model-invoked; WORKFLOW.md keeps direct ordinary tasks actionable without `implement`.
  SHA-256:
  - `implement/SKILL.md`: `2f48373f1ac0ba6bfdb268e2782cc996e4c17f6e9719bda322cd6567a6f7c322`
  - `implement/agents/openai.yaml`: `71b47a5cf2f39997f25a945bca880f4f2394ceb63a65bb4f3b1373d4287253bd`
  - `implement-spec/SKILL.md`: `8f08ba16c42f501dc6f025d32c6186bdc83406635bee3b2ed42d27bbfef02432`
  - `implement-spec/agents/openai.yaml`: `fde8416260ed2fe29f9231bfa296756b1e60be4f05450dfd39a3deb2038ec60d`
  These supersede the earlier sources of both skills (`d459183`, and `0017667` for
  `implement-spec/SKILL.md` under #1534). The pre-update Platform commit is `06a227110ba54407260c98e8a4a48c4a23587ddc`.
- `ask-matt`, `grill-me` and `teach` were removed from the set by owner decision 3 of #1674.
- Manual skills retain `agents/openai.yaml` with `policy.allow_implicit_invocation: false`.
  `pnpm docs:check` checks that policy for skills marked `disable-model-invocation: true`.

The custom coordination companion was removed under #1423. The installed `implement-spec` stands alone;
project coordination, per-ticket review and final integrated review are defined in
`docs/agents/coordinated-execution.md`.

## Set

- classify-change
- code-review
- codebase-design
- diagnosing-bugs
- domain-modeling
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
