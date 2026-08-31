# Telegram Membership consumer conformance

Status: **controlled two-application proof passed** for Platform #52 and Telegram #8. Credentialed
production smoke, deployment, and traffic remain Telegram #9/release work.

## Compatibility matrix

| Interface | Platform support | Fail-closed behavior |
|---|---|---|
| `inside.identity-linking.v1` begin | Platform generates a 32-byte base64url bearer, stores only its SHA-256/base64url digest and sends an opaque `principalRef` | transport/malformed response becomes `unavailable` or `recovery-required`; no link or entitlement |
| `inside.identity-linking.v1` confirmation | original authenticated Account and local `linkRef` select the stored provider transaction and return correlation | wrong Account is indistinguishable from missing; conflict/replay/expiry are typed terminal states |
| `inside.membership-evidence.v1` ingress | Bearer-authenticated POST plus durable `Idempotency-Key` and explicit evidence source | auth/schema/version/principal failure cannot update the current entitlement projection |
| Platform access | `MembershipEntitlements` accepts monotonic evidence and `ContentAccess` reads its finite local projection | non-member, expiry, outage and stale evidence deny without a Telegram call |

The identity-linking schema and named fixtures are vendored from
`sachkov-inside/inside-telegram@e62d6a7d07cd2df611134278ffeb0e59c68cdf53` with SHA-256
provenance. The normalized Membership Evidence corpus remains pinned to its Workspace source commit
in `MembershipEntitlements`; its schema and fixtures are byte-identical to the Telegram #8
snapshots. Neither test nor runtime imports another checkout.

## Controlled proof

Platform's autonomous PostgreSQL/API corpus starts a controlled loopback provider and uses the
production Platform HTTP adapter. In addition, the paired convergence run used:

- `sachkov-inside/platform@1e10837689a39665087da26fa6038faebbeb7596`;
- `sachkov-inside/inside-telegram@4d9aca2c5431200317a547a2c32d0fdc81e9cdb0`.

The durable split harness was rerun successfully at Platform
`2aee06c55a0cf9194afd6fa9278b9a7ba296136b` and Telegram
`6b0afc258312435b3cddec4c6c48d1202ab8b897`; application code above was unchanged.

It started the two real Nest/Fastify applications in separate processes and databases. Platform
called Telegram through `HttpTelegramLinkProvider`; Telegram returned evidence through
`HttpPlatformEvidenceAdapter`. Together the proofs establish:

- a trusted Account creates a five-minute deep link whose raw bearer is returned once and never
  persisted;
- a different Account cannot confirm that transaction;
- provider confirmation alone grants no access;
- initial evidence that races final Account confirmation is retryable and creates no durable
  receipt until the link is confirmed;
- authenticated fresh member evidence grants a bounded local entitlement;
- newer removal denies, older replay cannot restore, and newer rejoin can restore;
- expired positive evidence and provider outage fail closed;
- integration authentication and schema/version mismatch create no business projection;
- provider-specific Telegram user data is rejected by the strict normalized envelope.

The two-application path additionally demonstrated initial non-member, duplicate Telegram update,
duplicate identity conflict, real five-minute expiry during a deliberate provider outage, and
newer provider/subject recovery. The protected Material request observed exactly zero Telegram
membership reads while expired/outage access was denied locally.

Redacted terminal counts were 3 Platform link transactions (`linked=2`,
`recovery_required=1`), 2 current projections (`member=1`, `not_member=1`), and 18 evidence
receipts: 5 applied observed revisions, 12 accepted unavailable reconciliation observations during
the outage, and 1 unsupported-version audit receipt. Telegram delivered all supported evidence
sources (`link_time=2`, `member_status_event=3`, `reconciliation=12`).

Verification commands from the repository root:

```bash
pnpm check
pnpm test:integration
git diff --check
```

The cross-application journey is reproducible without sibling imports. Start Telegram's
`pnpm conformance:platform-provider` against a fresh loopback proof database, the Platform evidence
endpoint, and matching synthetic credentials. Then run from this repository:

```bash
DATABASE_URL=postgresql://inside:inside@127.0.0.1:5432/<platform-proof-db> \
CONFORMANCE_TELEGRAM_URL=http://127.0.0.1:44102 \
CONFORMANCE_TELEGRAM_CONTROL_URL=http://127.0.0.1:44103 \
CONFORMANCE_EVIDENCE_SECRET=issue8_evidence_proof_secret \
CONFORMANCE_LINK_SECRET=issue8_linking_proof_secret \
CONFORMANCE_WEBHOOK_SECRET=issue8_webhook_proof_secret \
CONFORMANCE_CONTROL_SECRET=issue8_control_proof_secret \
pnpm conformance:telegram-membership
```

`apps/backend/scripts/telegram-membership-conformance.ts` starts only Platform and drives the other
application through HTTP endpoints; the loopback-only proof control uses a separate synthetic
bearer. It rejects non-loopback URLs, PostgreSQL routing query parameters, and database names
without `proof`/`conformance`, waits through the real five-minute TTL, and prints a redacted
`CONFORMANCE_RESULT`. The paired Telegram report contains the complete two-terminal command and
disposal steps.

No real Telegram BotFather credential, chat identifier, Telegram user ID, email, bot token or
production endpoint is used or recorded by this proof. Provider-field negative cases use synthetic
contract fixtures only and never enter application persistence or logs. Task-specific proof
databases were removed after the redacted audit; the safe split harness remains versioned.
