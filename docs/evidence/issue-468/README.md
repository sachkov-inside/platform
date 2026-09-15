# Authoring workflow #468 — implementation in progress

This is an implementation checkpoint, not the acceptance or delivery receipt for #468.

## Owner inputs (2026-09-15)

- The local acceptance chapter is `working-with-agents` / `start`.
- The owner selected the existing paid practicum access model: Material `membership`.
  This choice applies to local acceptance; it does not publish or change access for customers.
- Existing Kinescope example: `06af55ae-3cb9-4868-b845-6a5cd7dff46b`.
  Provider project, readiness, ownership and duration have not yet been verified.
- The Inside Content primary checkout contains `inbox/Работа с агентом/` with ten existing
  recordings. The local source-path index still contains two unavailable old CI/CD paths.
  Exact local paths and acceptance choices are in Inside Content
  `_local/platform-468/acceptance-inputs.json`, outside Git.
- No video upload, provider metadata mutation, publication, merge or deployment was approved.

## Implemented boundaries under test

Source-bound Material reserve/apply/validate operations, stable source identity and original path,
optimistic content versions, ordinary editor Save/deletion protection, source-bound Guide operations,
programme membership guards, independent home feed selection/facets, and video chapter persistence
and reader navigation. Source fields and endpoints are included in generated OpenAPI.

`tools/authoring` currently contains the Markdown converter, immutable package validator and
persistent serial operation journal. It does not yet provide a complete synchronization or release
command. `pnpm test:authoring` runs these tooling regressions.

Inside Content exports an explicit selection into a checksummed portable package. The real first
chapter currently exports five Materials; approved cover assets and access metadata are still
absent from their original frontmatter. The local paid-access choice is stored separately.

## Verification so far

- Twelve isolated PostgreSQL integration tests (source import and migrations) passed. The source
  scenarios cover concurrent reservation, replay, renamed
  originals, rejected ordinary/stale mutations, feed query/facet scope, source programme protection
  and keeping a paid feed lesson attached to a Guide.
- Seven authoring-tool tests cover real Markdown constructs, unsupported syntax, identity on rename,
  package selection, paid access preservation, path/provider-field rejection, uncertain response
  replay and exclusive journal ownership.
- Type checking, lint and architecture guardrails passed at this checkpoint.
- Ten Inside Content package tests passed. Its complete 53-test run has one existing failure:
  `test_repository_templates_validate_as_drafts`, because the guide template has
  `reading_time_minutes: null`. The same failure was reproduced using `HEAD:tools/content.py`.
- The focused Web catalog and reader suite passed 25 tests. The complete check previously
  exposed an obsolete OpenAPI expectation and changed response-shape expectations; those were
  corrected. One image-processing test timed out under the complete run and passed in isolation.
  The subsequent complete `pnpm check` passed, including 669 backend unit tests,
  920 Web tests (one skipped), 139 browser scenarios (17 skipped), application builds, standalone
  config verification and Storybook build. These checks do not establish real author acceptance.
- No real upload, reader/browser acceptance, current-head CI or complete #468 acceptance yet.

The standalone Inside Content exporter is committed and pushed on its required primary `main`
as `bda4d3d`. The owner's existing Guide/catalog changes remain uncommitted and untouched.
The Platform diff remains in the isolated task worktree.

## Remaining implementation and acceptance

1. Complete target configuration, package application, asset/cover/artifact transfer, durable
   mappings and restore, guide composition, local watcher and automatic reader refresh.
2. Complete resumable video intake/transcription/upload orchestration and provider reconciliation;
   existing source and raw ASR files must remain unchanged. Persist exact attempts before calls.
3. Complete immutable release preview/apply/resume and explicit archive controls, keeping external
   operations behind approval of a concrete file/project or release package.
4. Complete templates and canonical runbooks, full repository checks, both required review axes,
   draft PR and current-head CI. Preserve the owner checkout and singleton runtime.
5. Perform desktop/mobile acceptance with the real AI-first selection, genuine images/artifacts,
   free standalone publication, paid feed lesson, both video paths, access and private bytes.

Do not close #468 or present this checkpoint as the finished authoring workflow.
