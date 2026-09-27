# Practice review interface evidence

Delivery: [#785](https://github.com/sachkov-inside/platform/issues/785).
Captured on macOS 27.0 arm64, 2026-09-27. Production implementation snapshot:
`77cdefe42224e09f686ac23abf7b59e8218e752d`.

The real full-stack fixture imports a synthetic Material and assignment through author HTTP APIs,
then opens Reader as a participant. PostgreSQL, object storage, API, MCP and Web belong to a separate
disposable local stand; the owner's checkout and Compose project are untouched.

- [Desktop Reader](reader-desktop-chromium.png), [mobile Reader](reader-mobile-chromium.png): the
  visible practice section, setup disclosure and existing production copy-prompt component. These
  are viewport captures, not a full image of both long requests. Companion JSON records the viewport,
  empty serious/critical axe findings and a 2000 ms delayed practice read.
- [Desktop public lesson](storybook-public-desktop.png),
  [mobile public lesson](storybook-public-mobile.png): the same production disclosure in Storybook,
  closed after its interaction test. Its reserved row is 44 px; the mobile document and viewport are
  both 390 px wide. No large placeholder or late automatic expansion is used.
- [Desktop prompt state](storybook-ready-desktop.png),
  [mobile prompt state](storybook-ready-mobile.png): the production Reader and prompt component in
  Storybook. Agentation remains available. No owner annotations were present in this session.

Full-stack assertions cover three scenarios at desktop and mobile sizes: private Reader waits for
its coherent body/practice result; public Reader shows its cached body while the closed practice row
loads without changing the actions' vertical position; anonymous/denied views do not receive the
protected assignment or body. The request copied to the actual browser clipboard contains the
stable assignment ID and context version. The setup link works before MCP configuration and returns
the public command guide over HTTP 200. Opening the public disclosure is an explicit user action.

After restoring the public cached path, the complete navigation suite passed 26 tests with its two
existing comparison-only skips. The web end-to-end suite passed 171 tests with 17 project-specific
skips. Storybook's copy interaction uses a deterministic clipboard adapter; the real browser
clipboard is verified separately by the full-stack test. Five practice stories pass, including the
closed public disclosure, unavailable result and no assignment.

These captures and local checks do not authorize publication, deployment or merge, and do not prove
live identity-provider onboarding or learning effectiveness.
