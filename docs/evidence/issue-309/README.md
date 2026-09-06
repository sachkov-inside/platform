# Issue 309 — broadcasts and communication analytics

Captured on 2026-09-06. Storybook uses source commit `f4d20f6`; working-page screenshots
were refreshed after integrating the funnel UI from `e528cbe` into this branch.
The broadcast route is now `/authoring/communications/broadcasts`, linked from the
existing funnel page `/authoring/communications`.

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Working draft editor | [Editor](./desktop-chromium-editor.png) | [Editor](./mobile-chromium-editor.png) |
| Analytics and entry history | [Analytics](./desktop-chromium.png) | [Analytics](./mobile-chromium.png) |
| Storybook draft and preview | [Storybook](./storybook-desktop.png) | [Storybook](./storybook-mobile.png) |

- Viewports: desktop `1440 × 1024`, mobile `390 × 844`.
- The working page uses the production Web BFF, Nest API, and an isolated PostgreSQL
  Testcontainer. Telegram is a deterministic contract stub; no real messages were sent.
- `pnpm smoke:communications` covers correcting an invalid draft without losing edits,
  saving, preview without sending, launch/pause/resume/cancel, source history, forwarded
  tracking links, anonymous access denial, keyboard access, axe, and horizontal overflow.
- The 14 focused Storybook tests also cover lifecycle and failure states, including
  blocking Resume while a paused draft has unsaved edits.
- Screenshots were visually inspected. This is the temporary semantic interface allowed
  for #309; final visual acceptance and integration remain in #317.
- Provider-backed acceptance in #310 is separate. These fixtures do not prove real Telegram
  delivery or attribution to a Platform account, reading, or payment.

Runtime and retry guarantees, including possible hit loss when the local database cannot
persist an event, are documented in [Communications v1](../../integrations/communications-v1.md).
