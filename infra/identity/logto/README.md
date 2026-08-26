# Disposable Logto identity proof

This environment proves the application flow for #49 and the pinned-runtime hardening gates for
#116. It is intentionally separate from the Platform Compose project and is not a production
deployment template.

Start the complete local proof from the repository root:

```bash
pnpm identity:proof:start
```

The command builds and starts the pinned Experience UI fork, Logto, its own PostgreSQL, Mailpit and
the Platform PostgreSQL. An idempotent bootstrap reads the pinned seed's disposable Management API
credential from the isolated Logto database, then configures the SMTP connector, API resource,
confidential web application, sign-in experience, branding and custom JWT through the Logto
Management API. It runs Platform migrations, writes generated local application credentials only
to ignored `.identity-proof/platform.env`, and starts the web/backend development processes. It
refuses to reuse a Compose environment owned by another session. No Console setup,
real email, deployment or production credential is involved.

The bootstrap registers `/callback` as the only application redirect URI. Authentication session
state remains owned by the official Logto BFF integration.

After startup, use any disposable email address in the application. Read its verification code in
Mailpit. The public endpoints are:

- Logto: `https://identity.inside.localhost:3301`
- Logto Console: `https://identity.inside.localhost:3302`
- Mailpit: `http://127.0.0.1:8026`
- Platform: `http://127.0.0.1:3000`

Stop the complete `identity:proof:start` session with `Ctrl+C`; its ownership-aware launcher stops
both Compose projects without deleting either database. If only `identity:proof:up` was run, stop
that isolated proof environment explicitly:

```bash
pnpm identity:proof:down
```

## Frozen artifacts

[`versions.json`](./versions.json) is the machine-readable ledger. The custom Logto image starts
from the official `1.41.0` multi-platform image by exact digest. That image corresponds to upstream
revision `91e55698a42f99438cd41ec2b16a1fc51dbdab8a`. PostgreSQL, Mailpit, `@logto/next` and `jose` are
also exact-versioned; the tooling test rejects floating image references.

Fork revision `inside.2` replaces exactly four upstream Experience files and applies the reviewed
[`patches/issue-116-logto-proof.patch`](./patches/issue-116-logto-proof.patch):

- `Layout/AppLayout/index.tsx` removes the provider signature from every state;
- `Layout/AppLayout/index.module.scss` removes the now-unused signature placement and applies the
  Platform light surfaces;
- `containers/VerificationCode/use-sign-in-flow-code-verification.ts` turns a verified unknown
  email into a registration without the redundant provider confirmation;
- `utils/sign-in-experience.ts` replaces the provider fallback title with `Sachkov Inside`.

The issue #116 patch keeps recipient throttling inside Logto. It makes the existing 10-send,
600-second normalized-recipient guard atomic, retains reservations across ambiguous SMTP failures,
redacts sensitive audit/webhook fields, removes raw SMTP provider errors and provides generic
Russian rate-limit copy. Platform does not add a mail relay, quota table, attempt cookie, CAPTCHA,
reauthentication protocol or second authentication session.

All other appearance stays provider-configured. The Management API bootstrap owns the empty logo,
forced Russian language, Platform accent and light-mode settings; this keeps the source delta small
and reviewable.

## Updating the fork

1. Create a disposable checkout of the next Logto release and record its tag, commit and official
   image index digest.
2. Compare the four files above against `fork/`, reapply only the documented delta and copy the
   resulting complete files into this directory. Rebase the issue patch without fuzz and inspect
   every changed upstream source file.
3. Update `versions.json`, the `Dockerfile` base digest/labels and Compose image digests together.
4. Run `node --test scripts/identity-proof-artifacts.test.mjs` and
   `pnpm identity:proof:build`. The image build runs upstream Experience typecheck and build.
5. Run `pnpm identity:proof:hardening`; it uses fresh disposable volumes and executes the
   concurrency, email outage, callback, refresh outage, single-Account and audit-redaction corpus.

## Production-hardening proof

Run the complete issue #116 gate from the repository root:

```bash
pnpm identity:proof:hardening
```

The isolated proof builds the pinned fork and asserts the exact 10-delivery/600-second recipient
cap under 12 parallel browser contexts, reload/back/new-browser bypass resistance, identical
generic Russian responses for unknown and existing Accounts, SMTP recovery, negative and replayed
callbacks, Logto refresh outage recovery, one
local `Account`, no Platform session table and redacted audit/runtime output. The source findings,
proof matrix and known limits are recorded in
[`docs/research/issue-116-logto-throttling-proof.md`](../../../docs/research/issue-116-logto-throttling-proof.md).

The fork is not declared production-ready by this proof. DNS/TLS, credential custody, monitoring,
backup/restore, email deliverability, provider timeout ambiguity and release operations remain
production infrastructure gates.
