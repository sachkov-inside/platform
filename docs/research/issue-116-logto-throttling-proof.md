# Logto 1.41.0 recipient throttling and production proof gates

## Scope

Issue #116 asks whether the exact Logto runtime used by Platform can bound repeated email-code
sends, fail safely during dependency outages, reject malformed callback traffic and preserve the
architecture in which Logto owns authentication while Platform owns one local `Account` and its
authorization facts.

This note records source inspection and executable observations for the pinned runtime. It is not a
general statement about later Logto releases.

## Pinned lineage

The machine-readable source of truth is
[`infra/identity/logto/versions.json`](../../infra/identity/logto/versions.json):

- Logto `1.41.0`, official image digest
  `sha256:7f79547e3d1fe569a3ecae757968a7cfc579687aa8164eec35113c0adc983c5b`;
- upstream revision `91e55698a42f99438cd41ec2b16a1fc51dbdab8a`;
- Platform fork revision `inside.2`;
- exact PostgreSQL, Mailpit, `@logto/next` and `jose` versions are recorded beside it.

The proof prints this ledger and the SHA-256 of the issue-specific patch before running browser
assertions.

## What upstream 1.41.0 does

Source inspection of `packages/core/src/sentinel/message-rate-guard.ts` and the related
`sentinel_activities` query shows:

- email recipients are trimmed, lower-cased and SHA-256 hashed before rate-limit storage;
- the built-in recipient policy allows 10 successful sends in a rolling 600-second window;
- the 59-second resend timer in Experience is only a browser-side affordance, not the security
  boundary;
- the server returns HTTP 429 with `request.message_rate_limited` after the recipient cap;
- suppressed sends for an unknown identifier still consume the same recipient allowance, which
  avoids making account existence observable through the counter;
- upstream performs count, provider send and activity insert as separate operations. Parallel
  requests can therefore cross the cap, and a database read failure in the guard is treated as a
  safe-to-continue diagnostic path;
- the upstream `Message.RateLimited` webhook context includes the recipient, and the generic audit
  sanitizer only covers a narrow set of keys.

Logto documents the distinction between connector-level, user-identifier and tenant-wide send
limits in its [send rate limit documentation](https://docs.logto.io/security/send-rate-limit).
Logto also documents `Message.RateLimited` as a webhook event in its
[webhook event reference](https://docs.logto.io/developers/webhooks/webhooks-events).

## Minimal `inside.2` fork

The patch remains inside Logto; Platform does not gain a mail relay, attempt cookie, quota table,
CAPTCHA, reauthentication protocol or second session.

The fork:

1. reserves a send in the existing Logto `sentinel_activities` table before provider I/O;
2. serializes reservations for one normalized recipient and action with a PostgreSQL
   transaction-scoped advisory lock;
3. returns 429 when all 10 slots in the rolling 600-second window are reserved;
4. fails closed if the reservation cannot be established;
5. retains the reservation after every connector failure because provider acceptance followed by a
   lost acknowledgement is ambiguous; a recovered provider can retry within the remaining slots,
   and the conservative reservation expires with the rolling window;
6. recursively redacts code, cookie, email, identifier, IP, OTP/passcode, phone, secret, state,
   token and verification-shaped audit fields;
7. redacts the recipient in `Message.RateLimited` webhook context and removes raw SMTP provider
   error text;
8. supplies one generic Russian message: “Слишком много писем. Пожалуйста, повторите попытку
   позже.”

This is an operational hardening of the IdP boundary, not a change to Platform's authentication
model. Logto's broader security controls and responsibilities are described in the official
[security overview](https://docs.logto.io/security).

## Executable observations

Run from the repository root:

```bash
pnpm identity:proof:hardening
```

The command owns isolated Compose projects and ports, creates disposable volumes, builds the exact
fork, configures Logto through its Management API, starts the real Platform API and web BFF, then
runs Playwright against Logto and Mailpit.

The proof asserts:

- 12 simultaneous fresh-browser requests to one normalized recipient result in exactly 10 Mailpit
  deliveries and 2 HTTP 429 responses;
- reload cannot add a delivery; after browser back, a fresh submit is still limited, and new
  browser contexts plus a case-variant recipient cannot add a delivery after the cap;
- both an unknown recipient and an already established `Account` receive HTTP 429 with the same
  generic Russian copy at the recipient boundary;
- an SMTP outage does not report delivery, and a retry succeeds once Mailpit recovers while slots
  remain; 10 ambiguous failures consume all 10 conservative reservations, so recovery cannot send
  an unbounded retry;
- only `/callback` is routed, and missing, replaced, mismatched, replayed and 20-way raced callback
  inputs cannot complete more than once;
- a real email-code callback creates one `accounts.accounts` row; a subsequent real sign-in maps to
  that row and the retired `identity_principals.platform_sessions` table remains absent;
- expiry plus a Logto outage produces `unavailable`; restart allows the official Logto session to
  refresh and return to `authenticated`;
- the backend verifier rejects issuer, audience, signature and time mutations, maps a controlled
  remote JWKS 503 to `dependency_unavailable`, and verifies a fresh token after the JWKS service
  recovers;
- application output and Logto audit rows contain none of the proof email, provider-error or
  generated-secret canaries; explicit callback code/state and bearer-token canaries are also sent
  through the failure paths and remain absent from captured output and audit.

The callback proof also exposed a pinned SDK detail: the authorization-code token is initially
cached under the default key even when the exchange body is audience-bound. The callback therefore
uses that exact fresh token for first-time `Account` establishment. Normal resource access uses the
audience key and the official refresh flow afterwards.

## Remaining production boundaries

This proof does not certify a production deployment. Production still needs real SMTP credentials
and deliverability evidence, DNS and TLS operations, secret custody and rotation, monitoring and
alerting, database backup/restore and point-in-time recovery, capacity testing, and an explicit
upgrade rehearsal for every Logto fork revision. A provider that accepts a message and then times
out remains inherently ambiguous; the conservative reservation prevents an amplification retry at
the cost of possibly consuming one slot. Regional or global/IP quotas and CAPTCHA are intentionally
outside #116 and require a separate abuse model before adoption.
