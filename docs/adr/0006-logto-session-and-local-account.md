---
status: accepted
---

# Let Logto own authentication sessions and model one local Account

Platform keeps the official `@logto/next` BFF cookie as its only authentication session and maps a
verified Logto `(issuer, subject)` directly to one local human `Account`. Platform owns business
permissions and Membership facts, but does not mirror provider sessions, model a generic
human/service Principal, or snapshot authorization into tokens. The earlier generalized
`IdentityPrincipals + Platform Session` model proved the protocol contour but added local
session/idempotency/reauth state and service abstractions without real independent consumers.

This deliberately accepts the maximum five-minute lifetime of an already issued Platform-audience
JWT after provider logout or suspension. Stronger Account disable/revocation and step-up are
deferred until a real sensitive consumer can define their exact guarantees. `materials:manage` is
the only current Platform permission; MembershipEntitlement remains a separate time-bounded content
access fact. A future M2M identity requires its own ADR only when an independent technical actor has
a concrete authorization consumer.
