# Telegram Membership consumer conformance

Status: controlled Platform consumer proof for Platform #52. Credentialed production smoke and the
provider-side convergence proof remain Telegram #8/release work.

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
in `MembershipEntitlements`. Neither test nor runtime imports another checkout.

## Controlled proof

The PostgreSQL/API integration corpus starts a separate loopback HTTP provider and the production
Platform HTTP adapter. It proves:

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

Verification commands from the repository root:

```bash
pnpm check
pnpm test:integration
git diff --check
```

No real Telegram BotFather credential, chat identifier, Telegram user ID, email, bot token or
production endpoint is used or recorded by this proof. Provider-field negative cases use synthetic
contract fixtures only and never enter application persistence or logs.
