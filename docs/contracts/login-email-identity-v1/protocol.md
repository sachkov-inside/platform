# inside.login-email-identity.v1

Owner: Platform Accounts. Consumer: the pinned Logto first-email adapter.
Task: [#461](https://github.com/sachkov-inside/platform/issues/461).
Status: draft Accounts source implementation; public routes and the trusted native adapter are not connected.
Migration0088 and real PostgreSQL corpus are authored. Local PG/native runtime proof remains pending.

The owning Zod codecs are in
`apps/backend/src/modules/accounts/facets/login-email-identity/login-email-identity.contract.ts`.
`pnpm --filter @inside/backend contracts:login-email:generate` projects them to Draft 7 JSON Schema.
Backend guardrails checks drift. Fixtures contain synthetic identities and email addresses.

The public begin body contains only an idempotency `commandRef`. The Accounts `loginEmailIdentity` facet derives the Account and exact issuer/subject from the existing request principal.
Neither a client-selected Account nor a subject can choose the attachment target.

Candidate, reservation and finalization envelopes are private server-to-server messages. Their
identity fields do not create another issuer, subject, session, permission or Account. Authentication
of this boundary remains part of the pending runtime adapter. A schema match alone is not proof.

The Accounts source and the pending native adapter divide responsibilities as follows:

1. Begin an intent for the current Telegram-only Account. Bind its reference to the exact existing
   owner and a fresh normal Logto interaction. The authenticated browser must match that operation.
2. Select the candidate email and native verification record. A different candidate supersedes
   only an unreserved intent; its old code or verification record cannot authorize the new candidate.
3. After Logto verifies the new address and current owner, reserve the normalized email fingerprint
   under the existing identity locks. Check the exact owner, intent, candidate, verification record
   and fresh Telegram receipt before authorizing provider commit.
4. The pending native adapter must attach the first email through the normal Logto interaction to the same user. The code, passcode
   TTL, delivery limits, attempt limits and one-time verification remain owned by Logto.
5. Finalize only from an authoritative committed provider receipt for that same intent, owner and
   candidate. Keep the existing Account, Telegram link, profile, progress and Account Rights.
6. If the provider outcome is unknown, retain the reservation and reconcile by operation reference
   and authoritative provider state. A timeout alone cannot release ownership or fabricate a receipt.

The codecs currently enforce strict shape, wire version, UUIDs, HTTPS issuer syntax, email syntax
and explicit receipt state. They reject codes, billing contact codes, access tokens and extra target
fields. Owning source now checks cross-field equality, issuer/subject, native interaction and private browser
binding, freshness, command idempotency, normalization, supersession and reconciliation. Pure policy
unit tests prove their selected decisions; they do not prove database races or provider behavior.

`Accounts.loginEmailIdentity` owns begin, candidate selection, reservation, finalization and
reconciliation. It accepts the existing verified Account principal; callers cannot select an
Account. `LoginEmailNativeAuthority` is a trusted adapter port, not an upstream Logto receipt API.
Its implementation must authenticate the existing private native browser record and correlate the
exact intent/interaction/owner. Public state + PKCE, client-supplied digests or structurally valid
wire envelopes cannot authenticate it. AccountsModule supplies no adapter yet, so writes fail closed.
Reconciliation authenticates that same native interaction even when the provider outcome is unknown.
No new cookies, JWTs, issuer, session table or email-code store is added.

Migration0088 adds an Accounts operation journal with an immutable candidate/verification pair,
one intent per native interaction, command idempotency and partial unique active Account/email
reservations. Account writers use their existing sorted Logto/email advisory locks. Ordinary email
and Telegram sign-in reject an active reservation, including the same owner's premature callback.
A database trigger also rejects direct Account email writes against that reservation. Conditional
journal transitions use parameterized Prisma SQL and validate raw rows at the database boundary.
The schema source maps the table; generated Prisma files were not edited or regenerated in LIGHT.

The intent admission TTL is ten minutes, an Accounts policy rather than evidence of Logto runtime TTL.
Reservation requires Telegram approval no older than five minutes (with thirty seconds clock tolerance).
A changed candidate/verification pair supersedes only a pending intent; a new command must use a new
normal native interaction. A reserved retry moves to reconciliation and cannot authorize another
provider write. Unknown outcomes retain the email reservation beyond TTL. Only an exact authoritative
attached receipt can finalize; journal finalization and the existing Account fingerprint update share
one transaction. No code path releases an unknown reservation on timeout or merges Accounts.
Definitive abort recovery and the real native receipt adapter still require the pinned runtime proof.

Public failures expose `unavailable`, `identity_conflict` or `expired` without another owner's data.
An own intent can expose `pending`, `reserved`, `finalized`, `superseded` or
`reconciliation_required`. These are implemented source outcomes; actual PG and native adapter execution remain gates.

Billing Contact remains independent. Its stored address, code and consent do not become login proof.
Real PostgreSQL races, native first-email attachment, lost responses and subsequent email sign-in
remain pending. Pinned source facts are recorded in
[interface research](../../research/461-mini-app-identity-interfaces.md); the first actual API proof
is still PENDING until the coordinator grants an isolated runtime slot.
