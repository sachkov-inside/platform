---
status: accepted
---

# One access-capability vocabulary behind a workspace package

[ADR 0022](0022-community-delivery-state-in-telegram-membership.md) put community access behind a
bought Guide. Delivering it left the rule with two owners: the server derived it in
`membership-entitlements`, and the browser derived it again in the billing contract, because a
storefront names the access a purchase opens **before** the server has granted anything. Three more
pieces of the same vocabulary were already duplicated: the global capability list, its schema and
the Guide-capability predicate. Nothing compared the two descriptions, so a buyer could read one
composition on the storefront and receive another after paying.

Platform therefore owns one workspace package, `@inside/access-capabilities`. It describes the
vocabulary once — the global capabilities, the schema that accepts them, how a Guide capability is
built and recognised — and derives from it what a capability opens. The set-level composition the
storefront shows is the same derivation applied to every capability, so the promise and the grant follow one
derivation instead of two descriptions that have to agree. What the check cannot see is a copy
under other names that avoids the `guide:` string; that one still belongs to review.

Both applications import that package and declare none of it. One root check,
`check-access-capabilities-boundary`, fails on a second declaration of any vocabulary name and on a
hand-built `guide:` string anywhere under `apps/*/src`, with a negative fixture proving it fails
when broken. The check lives at the root rather than in each application because the sides are two
and the rule is one.

## Consequences

- Adding a capability, or changing what one opens, is one edit in the package plus its test. Neither
  application can extend the vocabulary alone, which is the point: the storefront and the grant path
  are the two sides that must not drift.
- The package joins `@inside/material-blocks` and `@inside/legal` as a workspace package with a
  build step, compiled during `pnpm install` and again at the head of `pnpm check`, and named in
  both application images. A workspace package missing from an image breaks only the Compose jobs,
  which the required gate does not run, so `scripts/workspace-packages-in-images.test.mjs` now ties
  the two together.
- The composition keeps the order the set already had and appends what a capability opens, because
  that order is what a buyer reads on the storefront. The behaviour is pinned by the acceptance
  built for [#524](https://github.com/sachkov-inside/platform/issues/524), which caught an
  accidental reordering while this package was being introduced.
- Product rules did not change here. Separate community chats per Guide, capability levels and any
  new capability remain future decisions; this ADR only gives the existing rule one home.
