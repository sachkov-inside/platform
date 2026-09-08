# Local editor acceptance — Platform #396

The local authoring flow now saves Material edits and completed uploads automatically. The article
editor supports fullscreen editing, a paragraph-side block menu, inline image/file previews,
image sizing, tables, links and callouts. Embedded and fullscreen views share the article layout;
text formatting appears on selection. Tags and Series stay open, without duplicate labels; Series
has search and progressive rendering in a bounded scroll area. Topics use compact expandable rows;
Series composition opens inside the same row and
shows Material suggestions before searching. Telegram funnel and broadcast management routes are
retired from Platform. `platform:admin` is an explicit trusted Account grant; ordinary authors are
not promoted automatically.

Owner review is local only. No merge, production deploy, production permission change or real
Telegram send is part of this delivery. The established published-Material rule still applies:
saved edits are visible immediately, while the first publication requires an explicit action.

## Reproduce

Follow [Local editor acceptance](../runbooks/local-development.md#local-editor-acceptance), then
open `http://127.0.0.1:4396/authoring/materials`. The first owner check is creating one Material,
entering text, pasting an image, editing in fullscreen, then reopening it to confirm persistence.
Proceed to the other acceptance scenarios only after that feedback.

The runtime uses real Next/BFF/API, PostgreSQL and MinIO. Its local identity fixture and Kinescope
adapter are synthetic. Video selection/binding/persistence is testable; actual Kinescope transfer,
processing, playback and real Logto authentication are not proven by this runtime.

## Verification

- Root `pnpm check` passed: documentation/API contracts, lint, types, architecture guardrails,
  tooling, backend/web tests, browser routes, production build and Storybook build. This refinement
  passed 153 tooling, 424 backend, 491 web (one skipped) and 43 route tests (five skipped).
  A Storybook scenario checks searching and continuing a list of 45 Series. After the final
  focus correction, lint/types, 22 authoring stories and all 10 local regressions passed again.
- PostgreSQL integration: 34 files, 216 tests passed, including explicit admin permission grant and
  immediate revocation, migration replay and repeated collection metadata receipts.
- Full-stack smoke passed all 36 selected desktop/mobile scenarios in Material authoring and
  retired Telegram management routes, including publication, protected Reader assets, video
  association/deletion, stale edits, draft deletion and inline Series ordering. Identity and video
  playback use provider doubles; PostgreSQL and storage are real.
- Ten local browser regressions passed. They use `apps/web/playwright.editor.config.ts` against
  the running real local stack. They cover serialized in-flight edits, uncertain-receipt replay, inline uploads,
  clipboard/drop covers, Series composition, fullscreen, document block preservation and reload,
  persistent publication validation, ignoring late video results after removal, inserting between
  paragraphs, image-size persistence in Preview, and preserving the block anchor across a pending
  upload. Cancelling a link leaves the document unchanged. Escape dismisses the block menu before
  exiting fullscreen; article typography stays the same in both modes. Formatting buttons retain
  editor focus so a delayed focus callback cannot restore an earlier text selection.
- Final local views: [desktop](../evidence/issue-396/editor-desktop.png),
  [fullscreen](../evidence/issue-396/editor-fullscreen.png),
  [mobile](../evidence/issue-396/editor-mobile.png).
- Owner visual acceptance remains pending. This is not production-provider evidence.

## Review closure

Two independent read-only axes reviewed the change from `09290bf7` and then the fixes.

| Axis | Finding | Disposition |
|---|---|---|
| Standards | Table selection inserted controls into article flow | Fixed: controls use an overlay; browser regression checks editor position. |
| Standards | File download URL had a second owner | Fixed: `material-assets` exports one URL builder used by Reader and editor. |
| Spec | Late video completion restored a removed video | Fixed: removal/unmount invalidate operation callbacks and abort transfer. |
| Spec | Selecting another Series skipped pending save | Fixed: selection waits for all pending saves; failed save keeps current page. |
| Spec | Draft autosave erased publication validation | Fixed: publication errors remain separate from background save and transport errors. |

The paragraph-editor refinement was reviewed separately from `fd3565b2`:

| Axis | Finding | Disposition |
|---|---|---|
| Standards | No substantive findings | Contextual controls, owner boundaries and width contract checked. |
| Spec | Completing an upload moved the selected paragraph past the stored offset | Fixed: map the block anchor through document transactions, including while its menu is open. |
| Spec | Cancelling a new link left an empty paragraph | Fixed: insert a paragraph only after a valid URL is confirmed. |

Both static review axes reported no unresolved findings after these fixes. Runtime regression
results supplement, rather than replace, the owner's local visual check.

## Owner refinement: block spacing, layout and image delivery (2026-09-08)

This local iteration starts at `f18cf590` and follows the owner's next screenshots:

- Metadata uses two columns above the article on desktop and one column on narrow screens. The
  article retains the same text column in embedded and fullscreen modes.
- Adjacent top-level blocks have a visible gap. Shift+Enter inserts a plain paragraph after the
  whole current block, including a table or nested list. Empty paragraphs keep height in the
  editor, Preview and Reader. A rapid click can update the visible caret before the model receives
  selectionchange; the shortcut maps the DOM caret through ProseMirror's public `posAtDOM` API.
- The caption sits directly under its image. Size controls stay compact; a bounded settings panel
  contains the alternative description. Image selection does not show text-formatting controls.
- Empty table cells have height and visible column boundaries. Long identifiers wrap inside cells.
- Protected image failures show an explanation and a retry button while preserving the figure's
  dimensions and caption. The image ref also detects a failure that happened before hydration;
  relying only on onError missed that case in the browser regression. Preview starts loading
  images eagerly; Reader keeps lazy loading.

The owner's published material `f1ae8d7d-8577-4836-aac2-b92e2f8a5023` was inspected read-only.
Its image loaded in both Chromium and Firefox. The exact cause of the owner's earlier blank image
was **not reproduced or identified**. Successful current delivery and better failure handling do
not establish that the original cause is resolved. The next owner check is to reopen this local
material's Preview. No production data, deployment or external publication was changed.

Runtime proof: all 12 local editor regressions passed. The two new scenarios cover vertical section
geometry, code/table separation, rapid-click Shift+Enter, empty paragraph persistence, a real
1400×900 PNG through upload and responsive Preview delivery, pre-hydration network failure and
retry, caption/alt preservation, 320 px description-panel bounds and long table-cell text.
The last two geometric additions passed separately after review fixes. Firefox delivery/failure/
retry was also checked against the running local stack. The 24 authoring/upload Storybook scenarios
passed after retrying one stale Vite dependency-cache load. This iteration changes no backend or
BFF contract; the earlier integration/full-stack results above are historical, not newly rerun.

Both review axes checked the diff from `f18cf590`. Standards found the narrow-screen settings panel
and missing textarea focus indicator; Spec also found long table-cell text overflow. All were fixed
and the relevant browser geometry assertions passed. Both axes reported no remaining findings.

Current local screenshots: [metadata above article](../evidence/issue-396/editor-desktop.png),
[fullscreen](../evidence/issue-396/editor-fullscreen.png),
[320 px settings](../evidence/issue-396/editor-mobile.png),
[loaded Preview](../evidence/issue-396/editor-preview.png). Owner visual acceptance remains pending.

Root `pnpm check` passed on this refinement: 153 tooling, 424 backend, 491 web (one skipped),
43 browser routes (five skipped), production and Storybook builds. Log: `/tmp/396-refinement-check.log`.
The local runtime was restarted after the check.


## Image control selection fix and owner merge approval (2026-09-08)

The owner's disappearing image controls were reproduced after clicking the image. Tiptap applies
`ProseMirror-hideselection`, which makes the native selection background transparent; the global
selection foreground remained white. The selected block includes its labels, explaining the
apparent flicker without an upload or autosave failure. A feature-local CSS module uses
`color: currentColor` for hidden native selections. `inherit` is insufficient in Chromium because
highlight inheritance can retain the parent's highlight colour.

The new browser regression failed before the fix with white selected text versus muted normal
text. It covers repeated image selection, resizing and description toggles in embedded and
fullscreen modes. The exact owner scenario was also reproduced in Firefox. Evidence:
[readable selected image controls](../evidence/issue-396/editor-image-selection.png).

The owner accepted the editor and explicitly authorized merging #396 into main after this fix.
Production deployment remains excluded. The earlier pending visual/merge statements above record
prior acceptance stages; this instruction supersedes that merge gate, not the production gate.
