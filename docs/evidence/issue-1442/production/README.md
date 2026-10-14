# Product buyer journey implementation evidence

Issues: #1442, #1443, #1444. Production PR: https://github.com/sachkov-inside/platform/pull/1494.

## Source and review

Task base: `f29e6133456ca1036cf451aeca109047246d5a77`.
Production implementation: `3ded1e91`; review corrections: `88387fe5`; guardrail fixture correction: `ae3f14f0`;
live verification: `a56ad40b`. Independent Standards and Spec reviews found no remaining findings on `a56ad40b`.
The declared-response test fixture was subsequently aligned with the required durable `started` field.

## Visual evidence

All images in this directory were inspected. Storybook uses production components and private synthetic fixtures.
The `onboarding`, `checkout`, `purchases`, and `completed` images cover 1440 and 390 widths.
The capture asserted no horizontal overflow and used the repository whole-page helper.
Completed images show that Onboarding disappears from desktop and mobile navigation.

The `*-live-*.png` images come from the real Next/Nest/PostgreSQL buyer journey.
They cover checkout, purchases, and Product onboarding at desktop and mobile widths.
The test signs in through a synthetic Telegram provider and pays through the stand bank double.
It checks invalid email, real access fulfillment, Product terms, absence of email verification mutations,
and the default Product onboarding menu. The group entry remains preparing because the stand does not operate a real Telegram group.
The Next development indicator is visible in these live captures.

## Verification

- Backend/Web type checks passed.
- Focused PostgreSQL billing, community, Product access and learning tests: 86 passed.
- Explicit purchase reference refusal/ownership red-green test passed.
- Whole Product revocation with scoped and whole-platform grants: 2 passed.
- Local bank double: 11 passed, including the exact purchase-specific return URL.
- Declared response contract: 9 passed after updating the fixture for `started`.
- Focused Storybook tests covered checkout, onboarding, purchases, Product revocation and group configuration.
- Buyer journey: 2 passed on desktop/mobile against real Next/Nest/PostgreSQL. Owned smoke processes and database were stopped.
- Full `pnpm check` and current-head CI remain pending. Earlier aggregate attempts exposed lint, guardrail and stale fixture failures; those were corrected.

This evidence does not claim a real bank payment, Telegram membership change, publication or production deployment.
Prospective Offer/legal changes are tracked separately in #1464; edition 5 was not edited or published.
Production visual GO remains pending under `docs/agents/frontend-delivery.md`.

## Owner preview resource

Storybook: http://localhost:6006

- Onboarding: http://localhost:6006/?path=/story/pages-product-onboarding--link-telegram
- Checkout: http://localhost:6006/?path=/story/pages-product-purchase--for-sale
- Purchases: http://localhost:6006/?path=/story/pages-account-purchases--product-purchase

Owned process: PID `72035`, root pnpm PID `71998`, port `6006`.
Working directory: `/Users/dev/.herdr/worktrees/platform/worktree-silver-river-2547/apps/web`.
Source: the `feat/1442-buyer-journey` writing worktree. The server follows local edits.
Restart from the worktree root with `pnpm storybook`.
Before stopping, verify the PID, command and working directory still belong to this preview; then stop root PID `71998`.
Keep this preview running while the owner reviews the implementation. Owner Chrome tabs remain open.
