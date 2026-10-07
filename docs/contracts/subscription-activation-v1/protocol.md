# Subscription activation v1

The separate TELEGRAM_ACTIVATION_INGRESS_SECRET authenticates Telegram's verified identity and activation authority. No community-dispatch, membership-evidence or notification credential is interchangeable. All requests use private bot identity, never a user-supplied Account ID or membership statement.

POST /integrations/telegram/v1/subscription-activation/attempts persists attemptId and rule revision. Without an Account it creates no access. The same attempt resumes after linking. POST /evidence accepts source proof: exact audience, sourceRef, identityRef, accountRef, linkRef/linkRevision and ruleId/ruleRevision. checkedAt must not be future or more than five minutes old; validUntil must be future and at most five minutes after checkedAt. Clock and relational constraints are runtime assertions, not only JSON Schema validation. Every timestamp is an RFC 3339 UTC date-time with seconds, such as `2030-01-01T00:00:00Z`; fractional seconds are optional.

Course identity is SHA-256 of UTF-8 JSON array ["course", sourceRef, identityRef]. Different links/rules for this source do not produce new rights. Only the first committed activation starts the unlimited assignment. Its snapshot includes benefitPeriods; each right lasts its own tariff term from assignment, or indefinitely when no duration is specified. A course tariff grants course materials and community indefinitely, and support for six calendar months. Enrollment, grant, source relation, access change, attempt result and evidence receipt commit atomically. Revoke is an independent owner decision: retries never undo it. A lost answer is retried using exactly the original evidenceRef and payload. An expired proof requires fresh source verification.

POST /own-access requires the exact current private binding and returns independent grounds, Enrollment snapshots and admission state. A tariff never clears moderation. Responses are private/no-store. Examples contain synthetic identifiers; no provider is enabled by this bundle. Telegram #64 implements the consumer and real source verification.

## Current binding lookup (Platform #627)

`POST /integrations/telegram/v1/subscription-activation/binding` is an additive v1 operation. Portable definitions `bindingQuery` and `bindingResponse` in `schema.json` are authoritative; fixtures exercise both production Zod and JSON Schema. It uses only the existing `TELEGRAM_ACTIVATION_INGRESS_SECRET` bearer credential. Missing, invalid and other integration credentials return HTTP 401. All responses, including errors, carry `Cache-Control: private, no-store`.

The strict request is `{"contractVersion":"inside.subscription-activation.v1","identityRef":"identity-course-buyer"}`. The source authority supplies the privately verified identity; this is not username discovery or a public Account search. No internal Account UUID is accepted or returned. References are nonempty strings of at most 256 characters.

HTTP 200 returns one of:

- `{"ok":true,"value":{"contractVersion":"inside.subscription-activation.v1","state":"linked","binding":{"accountRef":"platform-principal","identityRef":"identity-course-buyer","linkRef":"00000000-0000-4000-8000-000000000002","linkRevision":2}}}`
- `{"ok":true,"value":{"contractVersion":"inside.subscription-activation.v1","state":"unlinked"}}`
- `{"ok":false,"error":{"code":"invalid_input"}}`, with `identity_conflict` or `unavailable` as the other allowed codes.

All objects reject unknown fields. `linkRef` is a UUID and `linkRevision` a positive integer. Linked references come exactly from Platform's current account-link state; the browser linking transaction's `linkRef` is not interchangeable. An absent or tombstoned binding is unlinked. Multiple current bindings are identity_conflict. Storage/provider read failure or malformed dependency output is unavailable, never an unlinked fallback.

Telegram can begin an attempt before linking, then look up the current binding before sending fresh verified evidence or querying own-access. Lookup creates no access and reserves no binding: a subsequent relink/unlink still causes existing exact evidence and own-access validation to reject stale references. Resolve the current binding again before constructing fresh evidence; do not rewrite an already accepted evidence receipt. Exact lost-response replay retains its existing durable result even after unlink. This endpoint performs no Telegram membership verification itself.

## Temporary Tribute state (#625)

The shared Enrollment view state adds `pending_verification` and `suspended_source`. This shared definition occurs in BOTH `ownAccessResponse.value.enrollments[]` and `activationResponse.value.enrollment` (when non-null). The activation outcome's own state enum is unchanged. Binding operations are unchanged. Registry activation was removed by #1064.

Platform owns these states. `pending_verification` means an approved temporary source lacks current usable confirmation (including TTL/timeout); it grants no temporary access. `suspended_source` means a confirmed source exit was latched; a later member observation does not restore that source. Telegram only validates and presents the state and offers the existing help/retry navigation; it does not derive policy or grant restoration. Independent Guide/course rights remain effective. Only Platform's explicit owner resolution or confirmed external period can replace an ended source.

## Tribute after #1064

Registry activation is removed. `verificationMode` accepts only `course_membership` when present;
`registry_lookup` is not an evidence decision. A former Tribute subscriber receives a personal
purchase invitation from the owner and pays for Inside. The subscription sale remains disabled
until the bank approves recurring payments. Historical Tribute Enrollment views remain readable;
these states do not enable a new free activation.

## Content scope `allGuides` (Platform #648)

`contentScope` in tier snapshots accepts an optional `allGuides: true`. It means every Guide of the
platform, including Guides published later; `guideIds` and `materialIds` stay required and are empty
for such a scope. The field is additive: a scope without it keeps its previous meaning. The starter tier
and a Platform subscription use it.

## Invitation redemption (Platform #908)

`POST /integrations/telegram/v1/invitations/redeem` is an additive v1 operation. Portable definitions `invitationRedeem` and `invitationRedeemResponse` in `schema.json` are authoritative; fixtures exercise both production Zod and JSON Schema. It uses only the existing `TELEGRAM_ACTIVATION_INGRESS_SECRET` bearer credential. Missing, invalid and other integration credentials return HTTP 401. All responses carry `Cache-Control: private, no-store`.

The bot receives the start payload `i_<code>` and sends the strict request `{"contractVersion":"inside.subscription-activation.v1","code":"<code>","identityRef":"<verified identity>"}` without the `i_` prefix. The code is 1–40 characters of `[A-Za-z0-9_-]`. No Account reference is accepted: Platform reads the current binding of the identity itself.

HTTP 200 returns `{"ok":true,"value":...}` with one `state`:

- `needs_account` — the identity has no Account yet. The first open claims the invitation for this identity; the bot offers sign-in and repeats the same request after linking.
- `purchase_ready` — mode `purchase`: the Account may now buy the Offer. `offerName` and the absolute `checkoutUrl` of the Offer's checkout page are returned; the bot answers with a payment button.
- `already_redeemed` — a repeat after redemption. It carries the same `mode` and the same kind of payload as the first answer, read again: the current Offer name, the same `checkoutUrl`, or the current view of the same Enrollment.
- `claimed_by_other` — another identity opened the invitation first.
- `expired` — not opened within 14 days of issue, or claimed and not redeemed within 30 days of the first open.
- `revoked` — the owner revoked it before redemption.
- `unavailable` — unknown code, or the Offer is not on sale. The claim stays; a later repeat may succeed.

Refusal states carry only `contractVersion` and `state`. `{"ok":false,"error":{"code":...}}` returns `invalid_input`, `identity_conflict` or `unavailable` (a dependency failed or an internal rule was broken). `identity_conflict` means that the identity is linked to several Accounts.

The operation is idempotent by `(code, identityRef)`: a lost answer is retried with the same request. Claim and redemption commit in one transaction. Purchase redemption admits the Account to buy that Offer for good, including an Offer with eligibility `invitation_only`.
