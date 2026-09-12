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
storefront shows is the same derivation applied to every capability, so the promise and the grant
cannot disagree by construction rather than by agreement between two files.

Both applications import that package and declare none of it. `check-backend-architecture` and
`check-web-architecture` fail on a second declaration of any vocabulary name and on a
hand-built `guide:` string anywhere in application source, with a negative fixture on each side
proving the rule fails when broken.

## Consequences

- Adding a capability, or changing what one opens, is one edit in the package plus its test. Neither
  application can extend the vocabulary alone, which is the point: the storefront and the grant path
  are the two sides that must not drift.
- The package joins `@inside/material-blocks` and `@inside/legal` as a workspace package with a
  build step, compiled during `pnpm install` and again at the head of `pnpm check`.
- The composition keeps the order the set already had and appends what a capability opens, because
  that order is what a buyer reads on the storefront. The behaviour is pinned by the acceptance
  built for [#524](https://github.com/sachkov-inside/platform/issues/524), which caught an
  accidental reordering while this package was being introduced.
- Product rules did not change here. Separate community chats per Guide, capability levels and any
  new capability remain future decisions; this ADR only gives the existing rule one home.
