# #1568: Product waitlist implementation evidence

## Source and review boundary

These captures show production presentation from `dd48b535f10e18146f7d39a8d05f4ba7be91f89f`
(tree `d48fb3118104b2b683ed268699cca31c19fd2f98`). They do not claim verification of a later
integration head. The production Next.js build succeeded on this source. No fixture module
enters that build. Storybook imports the same public presentation modules.

Actual independent risk/participation, Standards/Spec dispositions and security applicability:
[#1568 checkpoint](https://github.com/sachkov-inside/platform/issues/1568#issuecomment-6272090715).
Production visual approval remains pending. Prototype approval alone does not approve this build.

## Reviewable states

| State | Desktop (1440 wide) | Mobile (390 wide) |
| --- | --- | --- |
| Guest hero | [Capture](live-guest-hero-desktop.png) | [Capture](live-guest-hero-mobile.png) |
| Guest lower action | [Capture](live-guest-lower-desktop.png) | [Capture](live-guest-lower-mobile.png) |
| Confirmed hero | [Capture](live-confirmed-hero-desktop.png) | [Capture](live-confirmed-hero-mobile.png) |
| Confirmed lower action | [Capture](live-confirmed-lower-desktop.png) | [Capture](live-confirmed-lower-mobile.png) |
| Owner demand from real API/DB | [Capture](live-demand-component-desktop.png) | [Capture](live-demand-component-mobile.png) |
| Storybook representative demand | [Capture](storybook-demand-component-desktop.png) | [Capture](storybook-demand-component-mobile.png) |

PNG files are direct, unmodified Playwright locator captures. The mobile Storybook capture
includes the incumbent fixed authoring navigation at its lower edge. Production mobile demand
is also supplied separately. `capture-metadata.json` binds source, viewports and SHA-256 digests.
Reduced motion stabilizes existing course animations. Every capture asserts document
`scrollWidth === clientWidth`; fonts settle before capture. Existing accepted course content,
learner access and lower programme navigation are retained. The hero has neither invitation
copy nor secondary programme navigation.

Whole-page investigation used the repository `screenshotWholePage` helper. Its stretched-window
captures showed repeated shell strips at the lower edge, so these bounded state captures are
the visual evidence. No production styling was changed to hide capture artifacts.

## Executed behavior

A production Next.js server, real Nest HTTP application, migrated disposable PostgreSQL and
synthetic external identity provider were used. A browser exercised actual Web BFF and API
requests, durable membership and owner report reads:

- Both CTA slots show the same saved fact; keyboard Enter works.
- Reload and a second tab preserve the fact; withdrawal and rejoin synchronize both tabs.
- A failed withdrawal offers its own retry and performs withdrawal rather than join.
- A failed join retains the original signed intent, operation and `youtube` source even after
  the URL source is removed. Report captures show one active Account, three joins and two
  withdrawals from that browser sequence.
- A guest click creates an HttpOnly intent and carries the explicit return marker to sign-in.
  An ordinary injected session cannot consume an unconfirmed guest intent.
- An Account without Telegram shows the existing inline linking action, without false success.
- A delayed private read from a previous Account cannot overwrite the next Account's state.
- axe-core WCAG 2 A/AA and WCAG 2.1 AA found zero violations on the link-required production state.

The guest browser scenario stops at the external sign-in seam and uses synthetic sessions.
Actual SDK callback continuation, matching Account binding, abandoned intent cancellation and
retry lifecycle are covered by the checked-in auth/BFF module tests. No live Telegram login,
real owner Account, production data, outbound notification or payment was used.

## Focused verification

- Persistence/facet integration: 5/5, including uniqueness, concurrency, withdrawal/rejoin,
  stable receipt/source and reconstruction after migration replay.
- Nest HTTP boundary: 2/2, including AccountGuard/CurrentAccount, strict actor input,
  anonymous/private authorization and owner report counts.
- Auth/BFF/intent module suite: 22/22; lifecycle tests also passed independently.
- Course/report Storybook interactions: 26/26 on the implementation; subsequent fixes affect
  the production lifecycle adapter and test isolation, not these presentation stories.
- Web typecheck, lint, docs contract and Web/Backend architecture plus negative guardrails pass.
- Production Web build passes. Independent Standards and Spec reviews have no remaining
  blockers; separate security review passes, applicable across the tests-only final commit.

The Impeccable detector found the accepted prototype's left accent rule and two type sizes in
`waitlist-action.css`. The owner-approved proof pins this presentation; it was preserved.
The demand view scan found no findings. Existing documentation length warnings are unchanged.
Final-source aggregate CI and any remaining required verification belong to the isolated
integration deliverable and are not represented as passed by this focused evidence.

## Owned preview resources

Worktree: `/Users/dev/orca/workspaces/inside-platform/ai-waitlist-implementation`.
All URLs below are local to the owner's Mac. They are review resources, not publication.

- Production guest route: http://localhost:6019/products/ai-engineering?utm_source=youtube
- Storybook course: http://localhost:6018/?path=/story/pages-product-ai-engineering--waitlist-guest
- Storybook report: http://localhost:6018/?path=/story/pages-authoring-sales-funnel-report--waitlist-demand
- Production report: `/authoring/sales-funnel`, authenticated synthetic owner session only.

Listeners at capture: Storybook PID `20245` on `6018`, production Web PID `89062` on `6019`,
API/launcher PID `88400` on `6020`. The launcher owns a disposable Testcontainers database
and synthetic identity provider. It does not use the shared Compose stand. The accepted proof
on port `6017` and its PID `71783` remain untouched.

The session-owned launcher is `apps/backend/.reports/1568-preview.ts`; browser investigation is
`.reports/1568/browser-proof.js` and `.reports/1568/component-captures.js`. These ignored files and
synthetic browser states are local runtime artifacts, not production dependencies. Do not commit
or publish their session/environment files. The production launcher uses the same already-built
source with `WAITLIST_PROOF_PRODUCTION=1 WAITLIST_PROOF_SKIP_BUILD=1`.

Keep previews while visual review is pending. To stop them, first verify PID, command and worktree.
Send SIGTERM to this API/launcher PID; its handler closes its Web child, identity provider,
Prisma, database and owned temporary `apps/web/release-identity.json`. Stop only this Storybook
PID separately. Never stop a listener just because it occupies a familiar port.
