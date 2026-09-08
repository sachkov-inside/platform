# Local editor acceptance — Platform #396

The local authoring flow now saves Material edits and completed uploads automatically. The article
editor supports fullscreen editing, a block menu, inline image/file previews, tables, links and
callouts. Topics use compact expandable rows; Series composition opens inside the same row and
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
  tooling, backend/web tests, browser routes, production build and Storybook build.
- PostgreSQL integration: 34 files, 216 tests passed, including explicit admin permission grant and
  immediate revocation, migration replay and repeated collection metadata receipts.
- Full-stack smoke passed all 36 selected desktop/mobile scenarios in Material authoring and
  retired Telegram management routes, including publication, protected Reader assets, video
  association/deletion, stale edits, draft deletion and inline Series ordering. Identity and video
  playback use provider doubles; PostgreSQL and storage are real.
- Seven local browser regressions passed. They use `apps/web/playwright.editor.config.ts` against the running real local
  stack. They cover serialized in-flight edits, uncertain-receipt replay, inline uploads,
  clipboard/drop covers, Series composition, fullscreen, document block preservation and reload,
  persistent publication validation, and ignoring late video results after removal.
- Final local views: [desktop](../evidence/issue-396/editor-desktop.png),
  [fullscreen](../evidence/issue-396/editor-fullscreen.png),
  [390 px](../evidence/issue-396/editor-mobile.png).
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

Both static review axes reported no unresolved findings after these fixes. Runtime regression
results supplement, rather than replace, the owner's local visual check.
