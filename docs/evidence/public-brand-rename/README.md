# Public website brand rename

Source: `b1aabcee427f4a43cf209549c53bcea98ac50254`. Captured on 2026-10-19 from this task worktree.

The existing wordmark now reads `Sachkov Dev`; layout, colors and routes are retained. Public
copy follows [the product brief](../../product/platform-mvp-brief.md#публичное-название-сайта).
Published legal editions retain their original names; a separate site note explains the rename.

## Browser evidence

Task-owned Storybook at port 6123 uses production presentation modules. The runtime did not
expose a configured Storybook MCP endpoint, so the local catalog and browser were used.

| Surface | Story | Widths checked | Capture |
| --- | --- | --- | --- |
| Public shell | `patterns-application-shell--guest-desktop`, `--mobile-top-navigation` | 1440, 390 | [Desktop](shell-desktop.png), [mobile](shell-mobile.png) |
| First sign-in | `pages-welcome--first-sign-in`, `--first-sign-in-mobile` | 1440, 390 | [Mobile](welcome-mobile.png) |
| Legal section | `pages-legal-раздел--desktop`, `--mobile` | 1440, 390 | [Mobile](legal-mobile.png) |
| Identity Telegram confirmation | `patterns-identity-telegram-sign-in--pending` | 1440, 390 | [Desktop](identity-1440.png), [mobile](identity-390.png) |

At each width `document.documentElement.scrollWidth === clientWidth`. The public header's
accessible brand is `Sachkov Dev`; the identity wordmark has the same accessible name.
Images were inspected. The mobile shell story intentionally exercises scrolling, so its capture
shows the fixed header above the middle of the document.

## Image rendering

[Social card](social-card.png) is the actual PNG returned by `socialCardResponse({title: "Sachkov Dev"})`
under the React server condition. [Favicon](icon.png) is a 192px rasterization of `app/icon.svg`.
Both use the Cyrillic С monogram with the existing charcoal, white and orange colors.

These captures prove presentation with fixtures, not a live authenticated production session.
CI and production verification belong to the pull request and release evidence.
