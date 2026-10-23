---
status: accepted
---

# Products without subscription commerce

The [owner's 2026-10-23 access decision](../product/access-model.md#единая-выдача-доступа-решение-владельца-23102026)
supersedes the six-month Support term, configurable Tariffs, and the dormant-subscription policy below.
The target model gives the whole Product and removes subscription functionality altogether.
The original decision is retained as history.

## Current implementation of the accepted 2026-10-23 model

#1709 removes the recurring runtime, its routes, owner commands, jobs, card flows, Tribute ingress
and the membership-evidence bridge. One Account and Product have one lifetime state with source
and action history. Explicit withdrawal latches against payment/course replay; only an owner
restore command reopens it. Refund confirmation is a financial fact independent of withdrawal.

New commerce uses a direct Product Price and one best Promotion, a quote, and a separately reserved
purchase. Closing sales and archive deny unsent operations, including Payment Links. Already sent
operations retain their exact terms and reconcile without another Init. Confirmed fulfillment
issues the same Product Access idempotently. The three-calendar-month Support promise creates no
access expiry, recurring charge or repeat-purchase path. Publishing the concrete prospective legal
edition remains assigned to #1464; historical editions and accepted snapshots are unchanged.

Historical storage and receipt decoders remain passive. Migration inventory preserves unmappable,
expired and future technical facts without granting a Product inferred from whole-platform,
Material-only or membership-bridge history. Current explicit Product grounds can migrate; an
explicit Product withdrawal remains a durable latch. Review inventory before an authorized rollout.

## Historical 2026-10-20 decision

The owner decided on 2026-10-20 that Platform currently sells access to Products only by
one-time payment. Course activation and owner assignment grant Product access without creating
a Subscription. Subscriptions may become a separate offering later; they have no relationship
to Products in the current product model. This supersedes ADR 0033's subscription payment-option
and invitation-sales decisions. Historical financial records and accepted rights remain intact.

Product community access follows the Product's explicitly associated Telegram group, rather than
a platform subscription. Several Products may share a group; different Products may eventually
use different groups. An unassociated Product offers no community entry. The current provider
addresses the existing `primary` group only; adding another real group requires extending the
provider and delivery contract, not pretending another stored group reference is deliverable.
ADR 0034's explicit rights, Product association and revocation boundaries remain applicable.

For the first Inside AI Engineering cohort, Materials and community access are perpetual;
Support lasts six calendar months. The existing course sales commands express these terms.
Previously accepted snapshots are not rewritten by a UI change. Incorrect existing grants must
be corrected explicitly through audited access operations, preserving revocations and history.

The current runtime disables subscription sale, resumption, changes requiring payment and new
recurring charges regardless of bank terminal capabilities. Reconciliation of already sent
payments, refunds and historical records remains available. Legacy subscription mechanisms stay
dormant for that recovery; their presence is not a promise of a future subscription architecture.
The account shows Products and payment history, without subscription or renewal controls.
