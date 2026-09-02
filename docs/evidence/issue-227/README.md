# Issue 227 — safe Kinescope deletion UI evidence

Captured from the production Material Editor against the full-stack test adapter on 2026-09-02.

| State | Desktop | Mobile |
| --- | --- | --- |
| Destructive confirmation | [`confirmation-desktop.png`](./confirmation-desktop.png) | [`confirmation-mobile.png`](./confirmation-mobile.png) |
| Waiting for successful Save | [`pending-save-desktop.png`](./pending-save-desktop.png) | [`pending-save-mobile.png`](./pending-save-mobile.png) |
| Durable deletion requested | [`requested-desktop.png`](./requested-desktop.png) | [`requested-mobile.png`](./requested-mobile.png) |

- Desktop viewport: `1440 × 1024`; mobile viewport: `390 × 844`.
- The confirmation names the Platform-uploaded video and states that no deletion request exists
  before a successful Save.
- The pending state removes the primary Video from the draft while keeping the destructive intent
  local. The requested state appears only after the production Web BFF and Nest save transaction
  succeed.
- The deterministic provider proves responsive UI and Platform transaction wiring. It is not a
  credentialed Kinescope deletion and does not replace owner acceptance against the dedicated
  provider project.
