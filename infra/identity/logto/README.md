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

The launcher loads the generated environment before Platform migrations and application startup.
It does not require a root `.env`. To move the application listeners and the registered Logto
resource/callback URLs together, set the supported port overrides on the start command:

```bash
IDENTITY_PROOF_WEB_PORT=3500 IDENTITY_PROOF_API_PORT=3501 pnpm identity:proof:start
```

The bootstrap registers `/callback` as the only application redirect URI. Authentication session
state remains owned by the official Logto BFF integration.

After startup, use any disposable email address in the application. Read its verification code in
Mailpit. Without overrides, the public endpoints are:

- Logto: `https://identity.inside.localhost:3301`
- Logto Console: `https://identity.inside.localhost:3302`
- Mailpit: `http://127.0.0.1:8026`
- Platform: `http://127.0.0.1:3000`

The same bootstrap also configures the sign-in of the local stand, where Logto runs inside the
Platform Compose project behind the `identity` profile. `pnpm local:stand` sets `LOGTO_ON_STAND=true`,
which points the bootstrap at that project and makes it write the stand's generated values to
`.identity-proof/stand.env`. Both stands build the same pinned image; this environment stays
separate because it owns and destroys its own volumes, which a stand holding the owner's data must
never do. See [one stand](../../../docs/runbooks/local-development.md#one-stand-sign-in-and-purchase).

Stop the complete `identity:proof:start` session with `Ctrl+C`; its ownership-aware launcher stops
both Compose projects without deleting either database. If only `identity:proof:up` was run, stop
that isolated proof environment explicitly:

```bash
pnpm identity:proof:down
```

## Frozen artifacts

[`versions.json`](./versions.json) is the machine-readable ledger. The custom Logto image starts
from the official `1.44.0` multi-platform image by exact digest. That image corresponds to upstream
revision `79e9e3b0d9f505260d09c80d8a015e56fbc0ec01`. PostgreSQL, Mailpit, `@logto/next`, `@logto/node` and `jose` are
also exact-versioned; the tooling test rejects floating image references.

Logto 1.42 and later refuse to start on a database without the alterations of their version. Every
Compose start therefore runs `npm run alteration deploy <version>` after the seed: on an empty
database the seed is already current, on an existing one the alterations bring it to the pinned
version. The tooling test keeps the target equal to `versions.json`.

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

Fork revision `inside.8` prepares the #461 server-side Mini App binding. The same `inside-telegram`
connector accepts an approved provider attempt only after binding the original normal OIDC state,
S256 challenge, client and callback to its own browser secret. The fork retains this connector's
storage for bounded callback recovery. See the owning
[wire protocol](../../../docs/contracts/mini-app-sign-in-v1/protocol.md). `miniAppEnabled` is off by
default in the connector; Telegram also requires `TELEGRAM_MINI_APP_ENABLED=true`. Current draft
evidence is source/static/adapter only. Image build, native interactions, browser cookies and
first-email attachment remain pending; this paragraph does not claim runtime readiness.

Fork revision `inside.7` moved the fork to upstream `1.44.0` (#938); the learner access script keeps
its dynamic apps (CIMD) off. The
four Experience files and the issue #299 patches carry over unchanged in substance. Upstream 1.42
moved audit redaction from `koa-audit-log.ts` to `utils/sensitive-data.ts`; the issue #116 patch now
adds the same word-based key list there. Upstream masks with `******` instead of `[redacted]`, and
its redaction already runs on the final insert. The new
[`patches/issue-938-offline-access-consent.patch`](./patches/issue-938-offline-access-consent.patch)
lets a registered application opt into the dynamic-app compatibility that adds `prompt=consent` to an
`offline_access` request, through `customData.addConsentPromptForOfflineAccess: true`. The learner
public client uses it, so every MCP agent receives a refresh token. The image build runs the
patch's Jest test with the issue #116 test.

Fork revision `inside.6` keeps the Telegram action slot centered with Flexbox. Safari can paint only fragments of a newly inserted button in the former Grid slot; the native-browser reproduction and before/after evidence are in [#391 verification](../../../docs/verification/telegram-button-391.md). The button dimensions, loading animation and interaction stay unchanged.

Fork revision `inside.5` bounds each browser status request to eight seconds and retries interrupted loading; Chromium and narrow WebKit exercise the same presentation. The timeout includes response-body reading.

Fork revision `inside.4` integrates the Telegram confirmation screen from #303. The identity-owned
presentation in `fork/packages/core/src/routes/inside-telegram-view.ts` renders both the Logto route
and the Storybook fixture adapter (`Patterns/Identity/Telegram sign-in`). Polling, connector
sessions and the callback remain on the existing identity origin.

The generated `inside-telegram-theme.ts` embeds the current Platform light tokens and the pinned
Manrope Latin/Cyrillic fonts so the identity origin needs no third-party font request. After a
foundation or font update run `node scripts/telegram-sign-in-theme.mjs`; the tooling test rejects
drift. Its inputs are `apps/web/app/globals.css` and the installed, lockfile-pinned font package.
Regenerate before building the isolated Logto Docker context. The Storybook adapter imports this
same presentation, while production has no dependency on the Storybook fixture.

Other appearance stays provider-configured. The Management API bootstrap owns the empty logo,
forced Russian language, Platform accent and light-mode settings; this keeps the source delta small
and reviewable. It also owns the line under the sign-in form (#658): only `privacyPolicyUrl` is set,
`agreeToTermsPolicy` is `Automatic` and the `ru` custom phrase says that the terms of use are
accepted right after sign-in, on the Platform first sign-in screen. A production identity instance
applies the same settings through its own Management API step.

## Updating the fork

1. Create a disposable checkout of the next Logto release and record its tag, commit and official
   image index digest.
2. Compare the four files above against `fork/`, reapply only the documented delta and copy the
   resulting complete files into this directory. Rebase the issue patch without fuzz and inspect
   every changed upstream source file.
3. Update `versions.json`, the `Dockerfile` base digest/labels, Compose image tags and the
   `alteration deploy` target together.
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
local `Account`, no Platform session table and redacted audit/runtime output. The SDK compatibility
checks (#992) also prove sign-out, denied Account access with an invalid refresh grant, and a public
learner MCP client's `offline_access` grant and refresh against this fork. An invalid refresh grant
currently yields `unavailable` and an empty 503
Account response; it never opens Account access. Recognizing the provider's real `invalid_grant`
error as a guest session is tracked separately in [#1005](https://github.com/sachkov-inside/platform/issues/1005).
The proof starts MCP on port 3502 and provisions its public client through the production learner-access module. The source findings,
proof matrix and known limits are recorded in
[`docs/research/issue-116-logto-throttling-proof.md`](../../../docs/research/issue-116-logto-throttling-proof.md).

The fork is not declared production-ready by this proof. DNS/TLS, credential custody, monitoring,
backup/restore, email deliverability, provider timeout ambiguity and release operations remain
production infrastructure gates.
