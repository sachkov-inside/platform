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
Independent final Standards/Spec and production visual GO are pending. Proof acceptance is not production visual GO.

Review previews: Storybook http://localhost:6207 and real frontend http://localhost:3107.
These processes belong to this writer; API 3001 and other owners' previews remain untouched.
