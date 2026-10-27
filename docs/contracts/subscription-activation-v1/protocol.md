# Course Activation, v1 receipt compatibility

Course Activation issues one lifetime Product Access directly to the Product named by ActivationRule.
Only evidence from the separate Activation Source can issue access. A code selects the rule; code
possession, ordinary /start, sign-in and membership in the common community do not prove the source.
Unconfirmed grounds remain an owner review request. First actual free issuance starts the documented
three calendar months of support; there is no runtime access deadline. Repeat commands and different
sources preserve first issuance. Manual revocation blocks automatic activation until explicit owner restoration.

The canonical base is `/integrations/telegram/v1/course-activation`. The temporary
`/integrations/telegram/v1/subscription-activation` alias serves exactly these same course operations.
The wire `contractVersion` remains `inside.subscription-activation.v1` and evidence audience remains
`inside.platform.subscription-activation` to preserve uncertain writes and exact accepted receipts.
These strings do not enable subscriptions. New successful responses use `enrollment: null`;
old non-null Enrollment snapshots are passive receipt data only. There is no invitation HTTP operation.
The invitation JSON definitions remain historical decoders and cannot create rights or bank operations.

The separate TELEGRAM_ACTIVATION_INGRESS_SECRET authenticates the source authority. Requests carry
private verified identity, never a caller-selected internal Account UUID. Attempts create no rights.
Evidence binds exact sourceRef, identityRef, accountRef, linkRef/linkRevision and ruleId/ruleRevision.
Proof is valid for at most five minutes, checkedAt cannot be future, and validUntil must be future.
The Product Access, source first-issuance time, attempt result and exact evidence receipt commit in
one transaction. A lost response reuses the exact original evidenceRef and payload, even after expiry,
rule pause or unlink. Fresh verification must use a current binding; old binding references fail closed.

## Ordered rollout and removal gate

1. Deploy the provider with both routes and both historical and nullable-enrollment response decoders.
   Run the repository corpus in both applications and the real PostgreSQL course/binding tests.
2. Move Telegram PLATFORM_ACTIVATION_URL to the canonical route. Keep stored evidence bytes,
   attempt IDs, correlations, link revisions and accepted response receipts unchanged. Drain uncertain
   evidence deliveries by exact replay. Ordinary sign-in still resumes only an existing explicit attempt.
3. Verify that all consumers use the canonical route and that no pending/leased/uncertain legacy writes
   remain. Retain accepted receipts under their durable retention contract.
4. Remove the legacy route and codec only in a separately verified contract-removal change with an
   inventory of remaining receipts and a decoder migration. A rename alone does not satisfy this gate.

## Learner Product navigation (#1496)

`POST /own-access` accepts optional `includeProducts: true` to add `products` to its response.
Calls without this flag retain the previous response shape for the deployed bot.
Each Product contains `id`, nullable `slug`, `name`, separate `materials.state` and `community.state`,
and an optional absolute `programmeUrl` on the configured public site.
Each right is `available`, `expired`, `revoked`, or `unavailable`.
The bounded projection retains previously available Products after expiry, grant revocation, or Product exclusion.
It reuses the current resource-scoped capability decision; metadata alone never grants access.
Missing facts return an explicit unavailable result rather than a false expiry claim.

Optional `prepareCommunity: true` requests synchronous preparation through the existing community boundary.
Platform checks the exact current binding before preparation and rechecks it before returning.
Preparation preserves current rights and moderation; the consumer must still complete its checked admission action.

## Current binding lookup (Platform #627)

`POST /integrations/telegram/v1/subscription-activation/binding` is an additive v1 operation. Portable definitions `bindingQuery` and `bindingResponse` in `schema.json` are authoritative; fixtures exercise both production Zod and JSON Schema. It uses only the existing `TELEGRAM_ACTIVATION_INGRESS_SECRET` bearer credential. Missing, invalid and other integration credentials return HTTP 401. All responses, including errors, carry `Cache-Control: private, no-store`.

The strict request is `{"contractVersion":"inside.subscription-activation.v1","identityRef":"identity-course-buyer"}`. The source authority supplies the privately verified identity; this is not username discovery or a public Account search. No internal Account UUID is accepted or returned. References are nonempty strings of at most 256 characters.

HTTP 200 returns one of:

- `{"ok":true,"value":{"contractVersion":"inside.subscription-activation.v1","state":"linked","binding":{"accountRef":"platform-principal","identityRef":"identity-course-buyer","linkRef":"00000000-0000-4000-8000-000000000002","linkRevision":2}}}`
- `{"ok":true,"value":{"contractVersion":"inside.subscription-activation.v1","state":"unlinked"}}`
- `{"ok":false,"error":{"code":"invalid_input"}}`, with `identity_conflict` or `unavailable` as the other allowed codes.

All objects reject unknown fields. `linkRef` is a UUID and `linkRevision` a positive integer. Linked references come exactly from Platform's current account-link state; the browser linking transaction's `linkRef` is not interchangeable. An absent or tombstoned binding is unlinked. Multiple current bindings are identity_conflict. Storage/provider read failure or malformed dependency output is unavailable, never an unlinked fallback.

Telegram can begin an attempt before linking, then look up the current binding before sending fresh verified evidence or querying own-access. Lookup creates no access and reserves no binding: a subsequent relink/unlink still causes existing exact evidence and own-access validation to reject stale references. Resolve the current binding again before constructing fresh evidence; do not rewrite an already accepted evidence receipt. Exact lost-response replay retains its existing durable result even after unlink. This endpoint performs no Telegram membership verification itself.

## Content scope `wholePlatform` (Platform #648)

`coverage` in tier snapshots accepts an optional `wholePlatform: true`. It means every Product of the
platform, including Products published later; `productIds` and `materialIds` stay required and are empty
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

## Private owner announcement metadata

`POST /integrations/telegram/v1/subscription-activation/announcement` reads the current published
activation rule using the existing activation bearer credential. `announcementQuery` and
`announcementResponse` define the wire contract. Responses carry `Cache-Control: private, no-store`.
The query contains only the activation code and contract version. Success identifies the rule,
revision, registered source and single Product authorized by the current assignable Offer revision.
Unpublished, paused, expired, future, ambiguous and stale rules return `policy_paused`.
This read creates no learner attempt, identity binding or grant. The Telegram private announcement
operation compares the supplied Product/source with this response before preview or delivery.
