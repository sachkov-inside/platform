# SP1567-004: existing waitlist management after sale or access changes

## Bound source

Reviewed production head: `c143cdf67701f348cdc72cd61dcf4c9b42e734d4`, tree
`51684d016d6e6fe7894a42c7bf13bac5106f6274`. Comparison base:
`0fb45ce76693aa1b3dc786f0a28595962fb3f2cd`. Implementation commit `15422c97` was followed by
merging that integration tip, which includes the main lesson-pagination update. Its four files
have no changed relationship with this waitlist composition. No production fixture import was added.

This fixes #1567 scenario 5: an existing membership can still be withdrawn after an Offer
becomes available or the Account obtains learning access. Both primary purchase/learning actions
remain. A learner without a membership receives no new signup CTA. Previously started explicit
intents still show their continuation/result. The server selects both operational slots; their
one existing provider owns the Account-scoped fact and operation lifecycle.

## Responsive evidence

All PNGs are unmodified locator screenshots, inspected at 1440/390 wide with a 2000-high viewport,
reduced motion and settled fonts. Each capture asserts no horizontal document overflow. The
fixture dates, price and countdowns in these operational states are synthetic scenario data;
they do not set an opening date or open a real sale.

| State | Hero desktop | Hero mobile | Lower desktop | Lower mobile |
| --- | --- | --- | --- | --- |
| Live available Offer | [Image](live-offer-hero-desktop.png) | [Image](live-offer-hero-mobile.png) | [Image](live-offer-lower-desktop.png) | [Image](live-offer-lower-mobile.png) |
| Live learner | [Image](live-learning-hero-desktop.png) | [Image](live-learning-hero-mobile.png) | [Image](live-learning-lower-desktop.png) | [Image](live-learning-lower-mobile.png) |
| Storybook available Offer | [Image](storybook-offer-hero-desktop.png) | [Image](storybook-offer-hero-mobile.png) | [Image](storybook-offer-lower-desktop.png) | [Image](storybook-offer-lower-mobile.png) |
| Storybook continuing learner | [Image](storybook-learning-hero-desktop.png) | [Image](storybook-learning-hero-mobile.png) | [Image](storybook-learning-lower-desktop.png) | [Image](storybook-learning-lower-mobile.png) |

Additional mobile states: [live withdrawal retry](live-learning-retry-mobile.png),
[Storybook retry](storybook-learning-retry-mobile.png),
[Storybook continuing intent](storybook-learning-continuing-mobile.png).

The live fixture has no prior lesson progress, so its retained learning action is
«Открыть программу». The production composition test and Storybook also cover the existing
«Продолжить обучение» action with progress. Both use the same production learning-action module.

The previous [closed-state evidence](../README.md) remains evidence for its stated dd48 source.
Its presentation branch and copy are unchanged: the existing `WaitlistAction` body is untouched,
new CSS is scoped to `.waitlist-membership`, and the new existing-only slots apply outside the
closed/no-access/no-Offer branch. This applicability statement does not relabel old captures as
new-source captures or replace the pending production visual gate.

## Behavior and verification

Production server slot selection plus mounted `WaitlistProvider` was tested first: active
membership with purchase and with learning both failed for missing withdrawal controls; the
inactive learner case passed. After the fix all three pass. Auth/BFF plus composition tests pass
24/24; course Storybook tests pass 22/22. Web typecheck, lint and docs checks pass. On c143 the
production Web build, deterministic-test guard, Web architecture and negative guardrails pass.
The premerge focused-test inputs are identical after the four unrelated main files were merged.

The live browser uses the production Next build, actual Nest API and disposable PostgreSQL:

- An entitled Account's signed ready intent is completed through the real BFF/API. Both saved
  controls appear and no new learner signup CTA appears.
- A forced withdrawal failure keeps durable membership active. Keyboard Enter retries withdrawal,
  persists inactive membership and leaves learning available. Reload preserves the inactive fact.
- With an available Offer, both controls remain, withdrawal persists, the purchase action remains,
  the sibling tab updates and reload retains the inactive fact.
- A held Account A withdrawal is persisted, then its response is deliberately changed to failure
  after Account B completes its own explicit intent. B has both controls, no membership error or
  retry from A, and can withdraw independently. A and B reads confirm separate inactive facts.
- axe WCAG 2 A/AA and 2.1 AA reports zero violations for both live operational states.

The Account test uses actual browser fetch with same-origin credentials, as documented by
`fullStackBrowserRequest` in the repository. Earlier harness investigations used APIRequestContext,
which does not send renewed Secure cookies on HTTP loopback, and therefore observed guest reads.
A global alert check also counted an empty framework announcer. These were harness corrections;
final assertions still check B's real join response, Account identity, both controls, membership
errors/retries and durable withdrawal. `behavior-results.json` preserves these outcomes/limits.

The entitled ready-intent path was executed separately before the learning capture (the inline
CLI result at 18:27:41 UTC showed two withdrawal controls, no signup CTA, and a ready active
membership). The later Account proof also starts Account A from `continuation-state.json`
while its isolated learning grant is active, and awaits that real continuation before switching
to B. `sp004-learning-proof.js` then covers the already-confirmed membership and withdrawal.

No auth handler, Account cache key, API, persistence rule, entitlement or notification behavior
changed. Independent Standards and Spec review on c143 found no blockers. Spec checked the actual
keyed `ReadingProgressProvider` ancestor, which remounts the child provider when Account changes.
Its local notice, retry and continuation fields cannot carry over. Component risk is Medium under
trusted main `60816a1d05fcb3d0c95af96e2a2c8d0976aed00f`; whole-spec High remains. New trust/input
boundaries were not introduced; existing security conclusions remain applicable, supplemented
by the coordinator's scoped integrated security review and this browser negative.

The Impeccable scan reports only the previously accepted accent border/type-size choices in the
existing presentation CSS. New scoped membership styles add spacing, with no new finding.
The build also verifies the production graph remains outside Storybook fixtures.

These are focused results, not final-source provider CI or production visual GO. Those gates,
plus acceptance of the exact integrated High-risk result, remain with the coordinator/owner.

## Reproduction and owned previews

Worktree: `/Users/dev/orca/workspaces/inside-platform/ai-waitlist-implementation`.

- Live route: http://localhost:6019/products/ai-engineering
- Storybook Offer: http://localhost:6018/?path=/story/pages-product-ai-engineering--waitlist-existing-with-offer
- Storybook learning: http://localhost:6018/?path=/story/pages-product-ai-engineering--waitlist-existing-with-learning
- Storybook continuing: http://localhost:6018/?path=/story/pages-product-ai-engineering--waitlist-continuing-with-learning
- Storybook retry: http://localhost:6018/?path=/story/pages-product-ai-engineering--waitlist-withdrawal-retry-with-learning

Current owned preview listeners after restart: Storybook `6018`, PID `20245`, cwd `apps/web`, started 16:06:43 UTC;
API/launcher `6020`, PID `6814`, cwd `apps/backend`, started 18:30:19 UTC; its production Web child
`6019`, PID `6916`, cwd `apps/web`, started 18:30:23 UTC. The earlier live learning captures used the previous owned API/Web pair, PID `78620`/`79467`,
also running c143. That pair was stopped gracefully before restarting the same production build
with the isolated dummy bank/contact contour for the Offer scenario. API/Web report c143 source. Storybook
serves the same current production presentation source. Accepted-proof port6017 is already stopped
by the coordinator; its branch/source remain preserved.

Ignored runtime artifacts are `apps/backend/.reports/1568-preview.ts`, its
`1568-sp004-control.ts` fixture controller, `.reports/1568/sp004-{learning,offer,account}-proof.js`
and `sp004-story-captures.js`. No session/cookie/environment file is committed. The launcher owns
only its disposable Testcontainers DB, synthetic IdP and Web process. Its local test bank points
to unreachable `127.0.0.1:9`, with local SMTP capture, following the full-stack-smoke contour.
No payment, real login, external message or production configuration was performed.

Before stopping, verify each PID/command/cwd. SIGTERM to the owned API/launcher closes its Web
child, Prisma, IdP and disposable database and removes its temporary Web release identity.
Stop the owned Storybook PID separately only after review. Rebuild/restart the launcher from the
intended exact source using `WAITLIST_PROOF_PRODUCTION=1` and pinned Node26/pnpm; do not reuse a
build from a different source by setting the skip-build flag. Keep these previews while owner
visual review is pending. The coordinator receives ownership of them with the acceptance packet.
