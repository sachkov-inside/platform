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
