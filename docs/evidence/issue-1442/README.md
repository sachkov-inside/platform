# Buyer journey proof: #1442, #1443, #1444

Status: awaiting owner visual acceptance. This branch contains a Storybook-only proof, not production behaviour.

## Owner decisions, 2026-10-14

- Use one persistent Product checkout page with a progress strip and the purchase summary.
- Restore server-owned purchase state whenever the buyer opens that page.
- Show the applicable next action: pay, open the existing bank form, wait for payment/access, complete Product onboarding or open the Product.
- Reuse Account email. Ask for email only when Account has none.
- Associate a Telegram group with each Product. Keep the existing group; several Products can share it.
- Keep checkout concise: Product name, amount, applicable discount, payment action and purchase conditions.
- Keep purchase contents and periods inside expandable conditions; hide Account email and receipt explanations from the primary flow.
- After access is ready, open the Product. For community-enabled Products, place Onboarding first in the Product navigation and select it by default while incomplete.
- Show three steps: link Telegram, join the Product community, start the first lesson. Reuse verified linking and membership facts.
- Keep Programme, Materials and Artifacts accessible during onboarding. After the first lesson is started, a new default visit selects Programme.
- An operator revokes access to the selected Product as one action. The operator does not choose individual grant sources.
- Preserve unrelated Product access and learner history.
- Keep the broader editor redesign in #1448. This proof does not remove Topics.

## Proof

Run Storybook from this worktree. Open `Prototypes/Buyer journey / Checkout`.
The selector covers checkout, bank return, access preparation, community onboarding, purchase history and refunds.
All prices, Products, dates and identities in the proof are illustrative.
Buttons mutate memory only. Bank and Telegram events are explicit demo controls.
Refresh resets the proof; production must restore state from the authenticated server boundary.

## Implementation requirements

| Seam | Required evidence |
| --- | --- |
| Account email selection | HTTP/application tests with email-authenticated and Telegram-authenticated Accounts, with and without Account email |
| Purchase restoration | Authenticated purchase ownership; explicit purchase reference; refresh/new tab/no browser storage; distinguish multiple purchases |
| Payment command | Existing bank form recovery, repeat command identity and no duplicate charge on retry |
| Status updates | Payment, fulfillment and receipt update independently; confirmation does not stop polling while access is preparing |
| Product community | Product/group mapping; actual purchased capability; linked identity reuse; truthful invitation/request/membership failures |
| Shared group authorization | Union of valid rights from every Product bound to the group; refund/expiry/revocation of one Product preserves another |
| Bank refund | Authentic full refund revokes only the purchase's rights; duplicate/out-of-order events preserve unrelated rights and learning history |
| Operator revocation | Authorized Product-level action; impact preview; operator/reason audit; unrelated rights and progress preserved |
| Account purchases | Named Products and entry actions; current access distinct from financial history; applicable controls only |

## Existing implementation observations

On base `55f5bfa2b55500aa1e2949b936c95f68af0d892b`:

- `PurchaseReturnPanel` restores the reference from browser session storage and stops its interval on confirmed payment.
- `Tbank.init` uses one configured return URL for success and failure, without an explicit purchase reference.
- `AccountPurchasesPage` composes the generic community component next to purchases.
- `acceptBankRefund` records external full bank refunds and creates revisioned fulfillment revocation commands scoped to that purchase. Its complete test coverage must be assessed before changing it.

These observations are diagnostic inputs, not claims that the requested production path is complete.

## Preview resource

The owner requested this preview and still needs it for review.
Storybook listens on port 6006, PID 21860, cwd `apps/web` in this worktree.
Source: `prototype/1442-buyer-journey`, `src/storybook/buyer-journey-proof.stories.tsx`.
Stop this owned process with `kill 21860`. Restart from this worktree with `pnpm storybook`.
The owner's shared Chrome tab remains open; the temporary automation browser was closed.

## Presentation integration in this proof

The proof extends ProductProgrammeView with an optional onboarding panel. SeriesJourney owns its place in the existing Product navigation. Callers that omit the panel retain the original programme navigation; production routes do not supply it yet. The Storybook proof supplies the three-step panel and simulated events. This changes presentation interfaces, not bank or Telegram integrations.

The wider design-system investigation is tracked in #1455. The owner will add its reference links; research runs in a separate session.
