# AIE sales preparation — 12 October 2026

Status: prepared for review and serialized application by #854. Sales are closed.
The source of the approved commercial conditions and final gates is [#1359](https://github.com/sachkov-inside/platform/issues/1359).
The application procedure is [the sales setup runbook](../../runbooks/aie-sales-setup.md).

## Prepared files

| File | Purpose | Application gate |
| --- | --- | --- |
| [prepare.json](prepare.json) | New unpublished AIE Offer, one-time Option, archived questionnaire template, announcement cohort | Reviewed preparation, coordinated with #854 |
| [open-after-go.json](open-after-go.json) | Preorder cohort and publication of that Offer | #1358 acceptance, #854 technical readiness, concrete public-sale GO |
| [start-date.json](start-date.json) | Same Option at the post-start price; running cohort | At the start boundary, through #854; timely execution still needs confirmation |
| [baseline.json](baseline.json) | Sanitized read-only production state and public observations | Evidence only |

These are command arrays, not automatically executed migrations, seeds or a deployment hook.
Operation IDs remain fixed for exact-payload retries. Expected revisions require a fresh target check.
Publishing an Offer is a separate command in a separate file.

## Production observations

The read-only baseline records the observation timestamp, Product identity and catalogue state.
There was no AIE Offer, PaymentOption, promotion or cohort. The existing Inside subscription remained unpublished.
No account, grant, payment, content or production configuration was changed by this session.

The guest browser rendered the published Product, programme and closed purchase page:

- [Product](product-before.png): accepted description; lifetime Materials/chat, six-month support and no author code review.
- [Programme](programme-before.png): five chapters; 28 total Materials, 27 programme Materials, ten free Materials.
  The counters describe different collections; eight published Tasks were independently read from PostgreSQL.
- [Purchase](purchase-before.png): `Этот продукт сейчас не продаётся отдельно.`

HTTP GET returned 200 for `/legal/purchase/v5`, `/legal/privacy/v4` and `/legal/contacts/v2`.
The displayed editions/dates are recorded in `baseline.json`; this observation did not compare full legal-text digests.
The published Content identity and release evidence remain in [#1356](https://github.com/sachkov-inside/platform/issues/1356).

## Verification boundary

The isolated PostgreSQL rehearsal applies the same command arrays through the billing interfaces.
Synthetic questionnaire identities and personal codes stay in its disposable database.
Its quote and reservation checks contact no bank. Its local publication does not open production sales.
Production quotes, real payment/refund acceptance, signed-in production checkout and actual opening remain pending.
The current runtime requires a manual base-price transition; automatic execution is an unresolved owner decision.
