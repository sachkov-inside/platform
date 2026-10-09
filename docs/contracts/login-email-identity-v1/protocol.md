# inside.login-email-identity.v1

Owner: Platform Accounts. Consumer: the pinned Logto first-email adapter.
Task: [#461](https://github.com/sachkov-inside/platform/issues/461).
Status: draft wire envelopes only; routes, persistence and native runtime are not connected.

The owning Zod codecs are in
`apps/backend/src/modules/accounts/facets/login-email-identity/login-email-identity.contract.ts`.
`pnpm --filter @inside/backend contracts:login-email:generate` projects them to Draft 7 JSON Schema.
Backend guardrails checks drift. Fixtures contain synthetic identities and email addresses.

The public begin body contains only an idempotency `commandRef`. The future authenticated Accounts
operation must derive the Account and exact issuer/subject from the existing request principal.
Neither a client-selected Account nor a subject can choose the attachment target.

Candidate, reservation and finalization envelopes are private server-to-server messages. Their
identity fields do not create another issuer, subject, session, permission or Account. Authentication
of this boundary remains part of the pending runtime adapter. A schema match alone is not proof.

The planned operation has these requirements:

1. Begin an intent for the current Telegram-only Account. Bind its reference to the exact existing
   owner and a fresh normal Logto interaction. The authenticated browser must match that operation.
2. Select the candidate email and native verification record. A different candidate supersedes
   only an unreserved intent; its old code or verification record cannot authorize the new candidate.
3. After Logto verifies the new address and current owner, reserve the normalized email fingerprint
   under the existing identity locks. Check the exact owner, intent, candidate, verification record
   and fresh Telegram receipt before authorizing provider commit.
4. Attach the first email through the native Logto interaction to the same user. The code, passcode
   TTL, delivery limits, attempt limits and one-time verification remain owned by Logto.
5. Finalize only from an authoritative committed provider receipt for that same intent, owner and
   candidate. Keep the existing Account, Telegram link, profile, progress and Account Rights.
6. If the provider outcome is unknown, retain the reservation and reconcile by operation reference
   and authoritative provider state. A timeout alone cannot release ownership or fabricate a receipt.

The codecs currently enforce strict shape, wire version, UUIDs, HTTPS issuer syntax, email syntax
and explicit receipt state. They reject codes, billing contact codes, access tokens and extra target
fields. Cross-field equality, owner authentication, freshness, idempotency, locking, normalization,
supersession and reconciliation are runtime requirements; these structural tests do not prove them.

Public failures expose `unavailable`, `identity_conflict` or `expired` without another owner's data.
An own intent can expose `pending`, `reserved`, `finalized`, `superseded` or
`reconciliation_required`. These are draft outcomes, not implemented state transitions.

Billing Contact remains independent. Its stored address, code and consent do not become login proof.
Real PostgreSQL races, native first-email attachment, lost responses and subsequent email sign-in
remain pending. Pinned source facts are recorded in
[interface research](../../research/461-mini-app-identity-interfaces.md); the first actual API proof
is still PENDING until the coordinator grants an isolated runtime slot.
