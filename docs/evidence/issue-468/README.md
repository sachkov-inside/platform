> **Current workflow update (2026-09-15):** the owner replaced the filesystem watcher below
> with a one-shot import of a selected Git commit. Historical watcher results remain evidence
> only. Use `authoring:sync-git-local` as documented in the
> [local runbook](../../runbooks/local-development.md#local-obsidian-authoring-preview-468).
> No watcher or Git hook is installed or started. Uncommitted changes are excluded.

# Authoring workflow #468 — implemented, owner acceptance pending

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

Status on 2026-09-17, after the completion slice below:

1. Implemented: covers, Material artifacts, supplementary placement, archive proposals with
   explicit unpublishing, existing-record video attachment with chapters, the local upload runner,
   the full-stand target and the local release preview/apply. Automatic browser refresh was
   dropped with the watcher: the owner chose a one-shot import on 2026-09-15.
2. Not enabled: real Kinescope transfer and any release beyond this machine. Both need a separate
   owner approval of a concrete file/project or credential path.
3. Owner acceptance remains: one combined local run of the whole platform with the real AI-first
   product on desktop and mobile — sign-in, purchases, paid and free access, feed, covers,
   artifacts, video with chapters in test mode, archive proposal and release preview.

Do not close #468 before that acceptance.

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

## One-shot Git import acceptance (2026-09-15)

The local stand successfully imported Inside Content commit `af113300047b2e2aa1387b5a97078ba9f5aedf6d`.
Package SHA-256: `1b314b0f1c5243cdb005d5029c0dffe15d223577adf72a37689d5dbf4b841555`.
The first Git-based application updated 6 Materials and retained 102; an immediate repeat of the
same commit updated 0 and retained all 108. The programme still has 105 main Materials and
3 separate supplementary Materials. The successful commit and package are recorded in the
local state directory's `last-git-sync.json`. Uncommitted owner comments were excluded.

The exporter needed two portable-snapshot fixes in Inside Content: validating local dependencies
only for the selected package (`9d74799`) and matching Unicode-equivalent Material paths
(`af11330`). Selected missing dependencies remain errors. Exporter regression tests: 13 passed;
Platform authoring tests: 15 passed, including committed/staged/unstaged/untracked isolation,
old-ref selection and temporary snapshot cleanup. Lint and documentation checks passed.
The filesystem watcher was removed. Production publication remains outside this acceptance.

## Continuous programme list (2026-09-15)

Lesson card titles and previews are vertically centered. Ordinals use 16 px type and previews
are 64 px wide. Numbered pagination is replaced by an IntersectionObserver that reveals the
next 12 entries, with an accessible “Показать ещё уроки” fallback. The existing composition
response is progressively revealed on the client; this does not introduce a server cursor API.
Earlier rows remain mounted, and Reader return, browser Back and reload restore the target row.
Explicit programme tab selection resets the prefix to the first 12 entries.

Verification: root `pnpm check` passed, final lint passed, and Standards/Spec re-reviews passed.
Storybook interaction checks cover card geometry, appending entries and tab reset; routing
regressions retain validation of return URLs. The local real API stand demonstrated 12 → 24
entries, opening lesson 13, browser Back and reload restoration. After restart, switching from
Additional Materials to Programme returned to 12 entries. The updated fullstack scenario was
not separately executed through the fullstack harness. Local synthetic owner access remains
the scope of this preview; no production acceptance or deployment is implied.

Screenshots: [desktop](programme-continuous-desktop.png), [mobile](programme-continuous-mobile.png).

## Completion slice (2026-09-17)

Owner decisions: finish #468 before one combined platform acceptance; Kinescope stays in test
mode; the AI-first product page copy stays in Platform, so `guide.yaml` introduction fields are not
imported.

The full stand (`pnpm local:stand`) became an import target through the loopback
`authoring:stand-gateway`: Logto 1.41 exchanged a stand personal access token for an API token,
and the API accepted it for a stand test owner granted `materials:manage`. Importing Inside Content
commit `69c56921e233bc1fa3705e52d7a595fde479a927` applied 108 Materials in 15 seconds; the
repeat applied none. The programme page showed 22 chapters, 105 programme Materials and 3
Additional Materials. The live run exposed two defects that are now fixed and covered: paid
Materials validated outside their product, and supplementary originals were not placed.
`authoring:release preview` against the stand reported 108 unchanged and refused a production URL.

Automated checks: `pnpm test:authoring` (44), gateway unit tests, focused PostgreSQL integration
tests for source-scoped covers, artifacts and Guide archive, video upload init and MCP tools.
Inside Content received agent instructions for transfer, recording processing, archive and release.
Not verified here: real provider playback, buyer access through a purchase, mobile layout.
