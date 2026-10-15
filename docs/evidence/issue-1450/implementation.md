# Individual paid links — implementation contract

Assignment: #1450 and prospective legal integration #1464, coordinated by #1359. Base: bc5dfc3893193ffea76cc4241c5d0bb9340bb81a. Accepted proof/text: 48f2fc49320c77b3fe632868aa847ff99df3a761 (PR #1500), owner layout A. Prototype stays on its branch.

## Test seams

- BillingPricing: owner creation/list/revocation, public link status, authenticated quote. Test private checkout with unchanged catalog, owner authorization, amount/expiry validation and replay.
- BillingPricing.reserve and BillingPayments.purchase: real PostgreSQL reservation concurrency, revocation versus initiation, bank-confirmed failure retry, unknown reservation retention and one successful purchase. Existing payment consent, receipt, grant and refund paths remain authoritative.
- HTTP/BFF and buyer UI: validated input, guest entry and preserved link through sign-in, actual terms and server quote, payment status and unavailable links.
- Legal catalog: preserve historical editions/hashes and accepted snapshots; introduce approved edition 6 separately from production publication.

No new real link, bank charge, refund, message, public Offer or deployment is authorized by implementation. Existing #854 production writer retains runtime ownership. Actual terminal bounds remain server-owned. Source integration does not claim production publication.
