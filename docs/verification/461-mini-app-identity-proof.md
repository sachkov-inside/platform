# #461 isolated native identity proof

Status on 2026-10-10: **source preparation only; first actual pinned Logto API proof PENDING**.
The coordinator grants a bounded own-runtime/PG/Logto slot after #1304's normal stand priority.
This document does not grant that slot. UI and Storybook require a separate signal.
The full [#461 scope](https://github.com/sachkov-inside/platform/issues/461) remains assigned.

## Prepared ownership

`node scripts/mini-app-identity-proof.mjs plan` prints the context without external calls.
`prepare` writes only public configuration under this worktree's `.reports/461/runtime`.
Neither command generates keys, builds/pulls images or starts services.
`preflight` reads container labels, own volume/network names and listener ports; occupied resources or an unavailable inventory
fail the check. Repeat it immediately before launch: this observation does not reserve ports.

| Resource | Own value |
| --- | --- |
| Session | `platform-461-codex-20261010-identity` |
| Compose project | `inside-platform-461-codex-20261010-identity` |
| Image tag | `inside/logto-proof:1.44.0-inside.8-461-20261010` |
| Source | `infra/identity/logto/Dockerfile`, upstream `79e9e3b0d9f505260d09c80d8a015e56fbc0ec01` |
| Own files | `.reports/461/runtime/{context.json,compose.env,platform.env,tls}` |
| Issuer | `https://identity.inside.localhost:14601/oidc` |
| Logto / Management token endpoint | Loopback `14601` / `14602` |
| Own PostgreSQL | Loopback `14603`; databases `inside461` and `telegram461` |
| SMTP / Mailpit | Loopback `14604` / `14605` |
| Reserved API / BFF / Telegram provider | Loopback `14606` / `14607` / `14608` |
| Volumes | Project-prefixed `logto-postgres-data`, `platform-postgres-data`, `mailpit-data` |

`compose.461.yaml` starts only Logto, its PostgreSQL, application PostgreSQL and Mailpit.
Published ports bind `127.0.0.1`; container-to-host calls can use `host.docker.internal`.
Confirm callback host routing and hostname resolution in the actual runtime phase.
The own image tag prevents its future build from replacing a shared proof tag.

The context reader rejects changed project/ports/database URLs, another worktree path, symbolic
links and isolated bootstrap with `LOGTO_ON_STAND=true`. This proves target selection, not native
browser binding. Default `identity:proof:start`, Telegram local setup and shared stand commands
must not be used here. Do not link `.identity-proof`, source owner credentials or use shared PG.

## Bounded runtime recipe — not executed

Before build, pull or launch, get the coordinator's concrete slot and reread resource/singleton
guards. Record beforebytes, proposed own image/data delta and the permitted budget. Docker growth
has not been measured in this light preparation. A setup/compiler failure is not a behavior red.

1. Run own `prepare` and `preflight`. Preserve occupied containers, project-prefixed volumes/networks
   and ports; investigate ownership instead of deleting them.
2. Generate fresh TLS only in the own directory:
   `node scripts/identity-proof-certificates.mjs .reports/461/runtime/tls`.
   Trust its CA only through own process `NODE_EXTRA_CA_CERTS`; do not change system trust.
3. Use every argument from `miniAppIdentityProofComposeArguments(context)`: explicit project,
   own `--env-file`, and `-f infra/identity/logto/compose.461.yaml`. Build inside.8 only within the
   granted budget. Save image ID, revision/labels and compiler/patch checks.
4. Register the acquisition receipt and cleanup supervisor before the first service start.
   Cover partial start, failure, timeout and signals. Own host commands need the existing process
   group supervisor and bounded `finally` shutdown. Then start only the four services above.
5. Run `identity-proof-bootstrap.mjs` directly with
   `IDENTITY_PROOF_ISOLATED_CONTEXT=<absolute own context.json>` and
   `NODE_EXTRA_CA_CERTS=<absolute own certificate.pem>` in an explicit environment whitelist.
   The selector redirects seed SQL, endpoints, database and generated `platform.env` to the own
   context. Never source primary `.identity-proof/platform.env` or the owner's `.env`.
   Native synthetic Telegram enablement requires own fixture credentials and provider URLs.
   Keep delivery, community/marketing workers and production integrations disabled.
6. Verify actual readiness and each captured HTTP status/body before reading dependent logs or
   asserting an outcome. Keep normal native interaction cookies and original authorize/PKCE
   context. Do not add a cookie, JWT, session table, issuer or subject.
7. Stop own host process groups. If this run acquired the project, use the same Compose arguments
   with `down --volumes --remove-orphans`. Preserve the first failure if cleanup also fails.
   Verify own containers, networks, volumes and listeners are absent; keep redacted evidence.

The executable native HTTP journey, acquisition receipt and supervising runtime wrapper remain
to be connected under the bounded slot. The configuration helper has no service launch command.

## Pinned inside.8 API seam

[Pinned research](../research/461-mini-app-identity-interfaces.md) records **source facts**.
The bootstrap process adapter uses supplied Docker/HTTP doubles and proves target selection only.
HTTP error mapping, native cookies/redirects and authoritative provider outcomes remain PENDING.

| Native operation | Pinned source request | Actual proof barrier |
| --- | --- | --- |
| Fresh Telegram sign-in | Existing `inside-telegram` social verification and normal native callback | Exact native user, issuer, fresh record and original browser |
| First-email code | `POST /api/experience/verification/verification-code`, `{identifier:{type:"email",value},interactionEvent:"SignIn"}` | Own Mailpit message for that candidate; private code |
| Verify code | `POST /api/experience/verification/verification-code/verify`, `{identifier:{type:"email",value},verificationId,code}` | Same candidate and current verification record |
| Stage first email | `POST /api/experience/profile`, `{type:"email",verificationId}` | Same previously identified Telegram user |
| Submit | Native interaction submit | Native user read has the email and unchanged ID |
| Subsequent email sign-in | Normal native email code sign-in | Same issuer/subject and existing Account; no new permissions |

Prepare each control with fresh mutable data, a separate native interaction and synthetic
`example.test` addresses. Management reads may observe the committed user; a Management email
update must not create a successful native attachment.

| Control fixture | Required runtime outcome |
| --- | --- |
| `telegram-only` | First native email attachment retains the native user ID |
| `other-email-owner` | Foreign candidate fails without merge or disclosure |
| `already-email-owner` | First-email operation rejects replacement and preserves the old identity |
| `candidate-superseded` | An old code/record cannot authorize the new candidate or intent |
| `other-browser` | Public state/ref/challenge cannot fill the private native binding record |
| `expired-or-replayed` | Native one-time records and provider journal enforce expiry/replay |
| `unknown-submit` | Lost response retains reservation and reconciles from authoritative state |
| `delivery-limits` | Native TTL, attempts, message reservation and ambiguous SMTP use own Mailpit/transport |

These controls are not passing runtime fixtures. The trusted BFF-to-native bridge and first-email
reservation/finalization/reconciliation adapter remain unconnected. Neither source facts nor the
first native API feasibility proof establish physical Telegram WebView behavior.

## Real PostgreSQL corpus — prepared, not run

The own cluster initialization seeds `proof_461.owner` with this session in both databases.
This infrastructure marker is not a Backend migration. Own Backend setup checks it before
CREATE/MIGRATE, prepares one migrated template, and existing `TestDatabase` owns each case database.
`vitest.identity-proof.config.mts` does not start Testcontainers and selects only Accounts sign-in.

With Backend `IDENTITY_PROOF_ISOLATED_CONTEXT` pointing to the own context:

```text
pnpm --filter @inside/backend exec vitest run --config vitest.identity-proof.config.mts
```

Check the Telegram database marker first. Set `DATABASE_URL` to context `telegramDatabaseUrl`, then:

```text
pnpm --filter @inside/telegram exec vitest run --config vitest.integration.config.ts test/integration/bot-sign-in.integration.test.ts
```

The [#1320](https://github.com/sachkov-inside/platform/issues/1320) migration-history corpus also
requires that own PG slot and marker check:

```text
pnpm --filter @inside/telegram exec vitest run --config vitest.integration.config.ts test/integration/migration-history.integration.test.ts
```

Its communications-first/sign-in-first cases assert the exact retained31 names/receipts before031,
the exact current32 names, removal/reapplication of031 columns, preservation of legacy journal data,
and an unchanged ledger on repeat latest. Light source replay evaluates the actual final count/set
assertions with supplied SQL-result payloads; it does not execute these PostgreSQL histories.

These commands require the granted PG/runtime slot. Telegram bot-sign-in cases truncate their
own corpus database; migration-history cases roll back and reconstruct that separate database.
Existing bot-sign-in cases cover context/private-secret transfer, independent-connection
bind/replay arbitration, ordinary bot compatibility, stable subject, consumed receipt and competing
ownership. Backend uses real Accounts PG with a supplied Telegram provider for convergent
establishment, foreign subject, lost result repair and transaction rollback; this is not live Logto.

First-email PG persistence, supersession and unknown-result cases remain unimplemented. Current
login-email fixtures prove envelopes only. Before adding a Backend migration, rescan main/open
branches: #707 owns ordinal0087; Telegram031 is a separate namespace. Final full checks, current
reviewed-head CI, independent reviews and owner/device acceptance remain required for full #461.
