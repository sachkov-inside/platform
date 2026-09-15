# Authoring workflow #468 — implementation in progress

This is an implementation checkpoint, not the acceptance or delivery receipt for #468.

## Owner inputs (2026-09-15)

- Initial acceptance chapter was `working-with-agents` / `start`; the owner then requested the
  complete product for local visual validation.
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
persistent serial operation journal, local synchronization and source watcher. The broader release
workflow is incomplete. `pnpm test:authoring` runs these tooling regressions.

Inside Content exports an explicit selection into a checksummed portable package. The real first
chapter currently exports five Materials; approved cover assets and access metadata are still
absent from their original frontmatter. The local paid-access choice is stored separately.

## Verification so far

- Twelve isolated PostgreSQL integration tests (source import and migrations) passed. The source
  scenarios cover concurrent reservation, replay, renamed
  originals, rejected ordinary/stale mutations, feed query/facet scope, source programme protection
  and keeping a paid feed lesson attached to a Guide.
- Thirteen authoring-tool tests cover real Markdown constructs, unsupported syntax, identity on rename,
  package selection, paid access preservation, path/provider-field rejection, uncertain response
  replay and exclusive journal ownership.
- Type checking, lint and architecture guardrails passed at this checkpoint.
- Eleven Inside Content package tests passed after adding quoted prompt-boundary coverage. Its complete 53-test run has one existing failure:
  `test_repository_templates_validate_as_drafts`, because the guide template has
  `reading_time_minutes: null`. The same failure was reproduced using `HEAD:tools/content.py`.
- The focused Web catalog and reader suite passed 25 tests. The complete check previously
  exposed an obsolete OpenAPI expectation and changed response-shape expectations; those were
  corrected. One image-processing test timed out under the complete run and passed in isolation.
  The subsequent complete `pnpm check` passed, including 669 backend unit tests,
  920 Web tests (one skipped), 139 browser scenarios (17 skipped), application builds, standalone
  config verification and Storybook build. These checks do not establish real author acceptance.
- The programme and one real lesson were inspected in the local browser. No real upload, owner
  acceptance, current-head CI or complete #468 acceptance yet.

The standalone Inside Content exporter is committed and pushed on its required primary `main`
as `bda4d3d`, with quoted prompt-boundary fix `8250c46`. The owner's existing Guide/catalog changes remain uncommitted and untouched.
The Platform diff remains in the isolated task worktree.

## Remaining implementation and acceptance

1. Complete asset/cover/artifact transfer, durable mapping restore and automatic reader refresh;
   harden the first local package application and watcher into the full target/release contract.
2. Complete resumable video intake/transcription/upload orchestration and provider reconciliation;
   existing source and raw ASR files must remain unchanged. Persist exact attempts before calls.
3. Complete immutable release preview/apply/resume and explicit archive controls, keeping external
   operations behind approval of a concrete file/project or release package.
4. Complete templates and canonical runbooks, full repository checks, both required review axes,
   draft PR and current-head CI. Preserve the owner checkout and singleton runtime.
5. Perform desktop/mobile acceptance with the real AI-first selection, genuine images/artifacts,
   free standalone publication, paid feed lesson, both video paths, access and private bytes.

Do not close #468 or present this checkpoint as the finished authoring workflow.

## Separate owner-requested discussion after #468

Owner request, 2026-09-15: after finishing #468, assess what the product consists of and how its
parts should be named and modelled. This is a separate product discussion, not an expansion of
#468 or approval to rename entities now.

Questions to resolve:

- Product composition: main programme, additional learning Materials, practical artifacts and
  any other included parts. Distinguish the purchased product from its programme.
- Naming: the current glossary already defines Product as the public umbrella and Guide as its
  existing Platform domain name. Decide whether a technical rename adds value; Topic remains
  a Material's subject area, not the product container.
- Additional Materials outside the main programme: how the author adds them, how the reader
  finds them, whether they can be grouped, reused across products and linked from lessons.
- Progress and navigation: whether optional additions affect programme completion, numbering,
  previous/next and the promise made to an existing buyer.
- Access: whether additions are included in the product purchase, can also be free or belong
  to another product. Do not infer a new access or payment model from display grouping.
- Artifacts: templates, checklists and downloadable files remain distinct from full lessons,
  videos and explanatory notes.

Current evidence: CONTEXT.md already separates Product/Guide, GuideProgramme, Topic and Guide
Artifact. Inside Content has `supplementary_materials`, and its package exports
`supplementaryMaterialIds`; this does not prove end-to-end support. The Platform specification
currently describes chapters and a separate view of materials outside chapters, while progress
still counts the whole Guide. Verify actual implementation before proposing a migration.

Owner decision, 2026-09-15: the product page will have Programme, Artifacts and Additional
Materials tabs. Additional Materials can be free or paid using the existing access model and can
be marked viewed independently. They do not change main programme completion. Implement this
after #468; no technical entity rename is approved by this decision.


## Local product preview, 2026-09-15

Imported the current complete Obsidian AI-first package into the isolated editor runtime:
108 Materials, 22 chapters, 105 main placements and 3 supplementary reader URLs. Source files
remain the editing authority. The source watcher and loopback sync commands are documented in
[local development](../../runbooks/local-development.md#local-obsidian-authoring-preview-468).
Repeated synchronization preserved all 108 Materials without Save; an unchanged filesystem event
completed export and sync in 1.1 seconds. This is not a measured changed-document latency result.
The browser rendered the programme and the project-choice lesson with its variant blocks.

Limitations: no real video playback/provider acceptance, pending covers and artifacts, manual
browser refresh, a first-paragraph product teaser instead of the full long introduction. Local
synthetic owner access is not an acceptance check for buyer entitlements. #468 remains in progress.


Final local-loop verification for this checkpoint: root `pnpm check` passed again after the
local adapter work (including 13 authoring-tool tests). A temporary package copy changed one
real local Material, then the original package restored it: both operations applied exactly one
Material and skipped 107, retaining the same ID and URL, with content versions 2 → 3 → 4.
The Obsidian source bytes were not edited by this rehearsal. The stand and source watcher were
restarted for owner review. Platform CI and full issue acceptance remain outstanding.
