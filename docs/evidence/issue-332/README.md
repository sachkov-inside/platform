# Personal Home production evidence — #332

The production route uses private BFF, real API, PostgreSQL and the locally issued authenticated
Account sessions. Text open/mark/unmark, retry with the same command, account switching, anonymous
Home, personal failure, visible-only emission and SSR hydration are checked in Playwright.
Video evidence uses the actual Videos playback session and saved PostgreSQL progress. Only the
external Kinescope iframe SDK is a local double: this is not credentialed Kinescope proof.

Visibility edge tests control document.visibilityState. They verify that the first signal waits
for visibility and that a retry retains the original command after hiding and restoring the tab.
The Membership expiry/rejoin scenario changes the local fixture through the real entitlement
owner using a development-only CLI; it preserves and compares the same database visit.

Owner production visual GO is pending. Screenshots and automation do not replace that decision.
