# Unified course reading — production integration (#1414)

Fixed main: `bf23296a5f6a64cffd4cc1423f0e5dc8dc4c82f8`.
The same writer/worktree continues on `feat/1414-unified-course-reading`.

## Accepted sources

- Isolated proof: `bc2f8e6b41e1905e5dd70f177858134ba74505ad`, PR #1417, Part of #1414.
  Rendered code: `5b34fba14cfe9f3d01d6148cebf90704452e77ef`; proof subtree `209910224281cb5bbce8aba11a5d84a3db55507f`.
  Both independent Standards and Spec delta reviews passed. Historical `confirmed` screenshots belong to the old right-contents B; the accepted proof is `combined-b` on that branch.
- Parent B direction: `77a65abae16d57008fc9e2278942677ccc65e724`.
  Owner accepted the direction and authorized real integration with later refinements: 240 px rail,
  14 px constant-weight rows, text-only hover, calm custom chapter Select, minimal title/action/footer composition.
  This supersedes duplicated programme-context action panels, while standalone/fallback behavior stays intact.
- Exact real Reader dependencies merged: `7b5c6629f023a508fd6676594ee16baafd252d58`
  and `19afbf4cb383243995dcd909b9fec1f9c79253f1`.
  No prototype branch, fixture directory or prototype public assets were merged.

## Production ownership

`features/library-discovery` owns the client-safe course presentation and mixed sequence mapping.
Reader supplies only checked `from` context. Product Task supplies its known Product slug.
The mapping uses `productChapterRuns` and `placeChapterTasks`; task anchors use MaterialId.
Mixed positions never replace Material ordinals, reading progress or Material counts.
Guest composition remains public; history, session, personal access and writes remain private.
The real body renderer, model comparison, protected assets, mode variants, MCP instructions,
forms, validation, recovery and saved-state adapters remain production-owned.

`features/project-harness` supplies narrow diagrams for the recognized version-2 guide/task.
The source version and ordered heading shape guard the adapter; changed sources use ordinary Content rendering.
Text and stable anchors remain in the original renderer. Warm canvas and component hues follow semantic tokens.

## Verification and review

Initial focused checks passed: TypeScript; web architecture/negative guardrails; docs contract;
12 programme/context module cases; Storybook course pending, shared save failure/retry, submitted task,
chapter selector and server-step changes. A live DOM measurement confirmed 240 px rail, contained chevron,
and `scrollWidth === clientWidth` at 1440.

Final production screenshots, exact rendered commit/tree, streaming evidence and check results belong in `production/`.
Full `pnpm check` is reserved for the stable integrated head after review fixes, as requested.
Independent final Standards/Spec delta confirmation and production visual GO are pending. Proof acceptance is not production visual GO.

Review previews: Storybook http://localhost:6207 and real frontend http://localhost:3107.
These processes belong to this writer; API 3001 and other owners' previews remain untouched.

## Review corrections against a403ffd3

The independent review covers `bf23296a...a403ffd3`; the following corrections precede final captures.

| Axis / finding | Resolution |
| --- | --- |
| Standards S1 | Reset stored chapter selection on a changed server key; the A–B–A story selects a different chapter before leaving and confirms reset on return. |
| Standards S2 | Nested guest login anchors, loading and resolved controls share a 36 px footprint. |
| Standards S3 | Fully specify centered pseudo-element geometry; measured guest controls have 44 px target height at 320 px, without adjacent overlap. |
| Standards S4 | Action labels use 14 px from sm and 12 px on phones. |
| Standards S5 | Course stories use `publicPageEnvironment` and the actual application scroll container. |
| Standards D1 | Remove the repeated save-error assertion after removal of the duplicated lower panel. |
| Spec F1 | Use one scoped Task body rhythm; all nine real heading-to-paragraph gaps measured 10 px at 1440 px. |
| Spec F2 | Common rail/dialog rows make no access claim from guest-cached composition. Target pages retain real authorization; public body does not wait for personal navigation. |
| Spec F3 | Pending/access course headers reserve disabled bookmark and written reading controls. |

Coordinator corrections restore the per-chapter mixed count and authored chapter ordinal, retain the normal
legal footer, and scope calm trigger/option hover to course reading. Source-shaped diagram fallbacks remain.
Existing full-stack/navigation behavior assertions now target the one course action row and named footer;
standalone duplicate-panel checks remain meaningful. A held-private-practice production navigation case is
prepared for the final production-build suite; its execution result is recorded with final checks.

Focused correction checks: TypeScript and Oxlint passed; 12 module cases passed; five affected Storybook
cases passed after the A–B–A story awaited Select dismissal. Web/negative guardrails and docs contract passed.

## CI diagnosis before final evidence

Run `38387178752` exposed old composition assertions in UI and navigation checks. Loading stories now
compare the known course header/actions across pending and resolved states, including 200% text; the
unknown route skeleton remains separate. Video checks reserve one written disabled action. Task source
anchor checks retain collision/alias coverage through the real single submission action.
Programme return checks use the real rail or mobile dialog; request admission and payload assertions stay intact.
The held-practice test initially inspected a shared backend journal containing earlier archive/mode cases.
It now clears that journal before its request window and retains the same zero-authorized-product-read
assertion, held personal practice barrier and public body assertion. The request journal is attached by Playwright.
Eleven affected UI cases passed locally after these test corrections. Final production-build navigation results
are recorded after the mandatory check. Route flicker is a separate owner-requested follow-up, #1426;
future visual/editorial planning is #1427. This ticket does not expand route architecture.

## Final production evidence

Rendered production code: `3b0588e2d2b5f6db04349304f64d723b9e80ec28`; source tree is recorded in
[production/metrics.json](production/metrics.json). Production UI is unchanged from independently
accepted `086adfc84c0b6cef42b38aaa88e062add7492a68`; the intervening diff aligns tests and capture code.
The confirmation removes the browser-storage notice through its actual button. Whole-page captures use the
shared helper and assert `scrollWidth === clientWidth` first. Every image was inspected; hashes and dimensions
are in [production/images.json](production/images.json). The local Next dev badge is preview infrastructure.

- Real guide: [desktop](production/live-guide-1440.webp), [390 px](production/live-guide-390.webp),
  [320 px](production/live-guide-320.webp), [200% text](production/live-guide-390-text-200.webp).
- Real task: [desktop](production/live-task-1440.webp), [390 px](production/live-task-390.webp),
  [320 px](production/live-task-320.webp).
- Derived diagram details: [pastel overview](production/live-guide-overview-detail.webp),
  [Brief focus](production/live-guide-brief-detail.webp). These are crops of the inspected desktop whole page.
- Keyboard chapter picker: [open selector](production/live-chapter-keyboard.webp).
- Operational Storybook: [pending](production/story-pending-320.webp), [access](production/story-access-320.webp),
  [submitted task](production/story-task-submitted-1440.webp), [task-only](production/story-task-only-1440.webp),
  [navigation/history fallback](production/story-task-fallback-390.webp).

Measured desktop rail is 240 px; prose/figure column is 688 px. Chevron stays inside the chapter trigger.
All captured widths (1440/390/320) and 200% phone text have no horizontal overflow. Written reading label
remains visible at 320 px; pending and guest controls are 36 px high with at least 44 px target height.
Action labels measure 14 px on desktop and 12 px on phone. Actual Task and standalone fallback body sections
have 10 px heading-to-paragraph gaps. Task → pipeline → task Range measurements preserve the exact two lines:
`Как устроен пайплайн ` / `разработки с агентом`. Mobile programme opens and closes by Escape;
chapter selection opens, moves and confirms by keyboard. These checks do not claim to fix #1426 flicker.

Accessibility: live route scans report no violations. Whole-iframe Storybook scans retain one moderate
`region` result for the shell skip link `.fixed`; they are not zero. The iframe has hidden Storybook
no-preview documentation links before that control. The owning `[data-story-content]` scope reports zero
in the diagnostic comparison; [a11y-scope.json](production/a11y-scope.json) records both results and the
scaffolding. No rule is disabled. Manual capture uses the existing `globals.a11y.manual` mechanism so it
cannot race the addon scan. Failed scan attempts did not restart design exploration; only remaining story
captures were resumed. Script nullability passed `tsconfig.scripts.json` with pinned Node 26.10.0/pnpm 11.27.1.

Independent Standards and Spec passed 086adfc8; Spec also passed the test-only delta to 3b0588e2.
Required final `pnpm check` and current-head CI follow this evidence commit. Production visual GO remains pending.
The ECR 429 failure on the prior CI head happened before compilation; #1324/#1390 track that provider issue.
