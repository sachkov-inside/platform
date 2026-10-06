# Sachkov Inside Telegram

Telegram application of Sachkov Inside, maintained in `apps/telegram` of
[`sachkov-inside/platform`](https://github.com/sachkov-inside/platform).

The application implements the Membership bridge and the Telegram runtime for Inside
communications and marketing. It connects a Telegram contact to a Platform Account, observes
membership in the canonical closed chat, and supplies bounded evidence to Platform without making
content requests wait for Telegram. Platform owns permissions and access decisions.

Telegram keeps its own process, database, migrations and release sequence inside the repository.
The [production runbook](docs/operations/production.md#проверенный-переход-в-platform) records the
completed release/deploy transition, the verified rollback and the limits of that technical proof.
Feature enablement and acceptance with real Telegram users follow their separate owner gates.

## Historical Membership conformance milestone

The **controlled Platform convergence** milestone verified the implemented Membership bridge.
Final Platform confirmation schedules a canonical-chat check, authenticated `chat_member` updates
produce ordered newer evidence, and
durable reconciliation repairs missed events before positive evidence can outlive its five-minute
bound. The production HTTP adapters have passed the two-application conformance journey recorded
in [`docs/verification/platform-conformance.md`](docs/verification/platform-conformance.md).
That historical conformance proof does not establish current production feature enablement or
real Telegram messaging. Current deployment evidence belongs to the production runbook above.

## Author templates and communications contract

The author-template slice adds explicit `/template` intake and authenticated template read/save.
It also provides versioned contracts for the later communications operations. Platform remains the
permission authority; author checks fail closed until its authorization endpoint is configured.
See [`docs/integrations/communications-v1.md`](docs/integrations/communications-v1.md) for the
wire contract, fixtures, media validation and the limits of this enabling delivery. The runtime
supplies draft/publish, source routing, one common intro, durable multipart scheduling and one-time
broadcasts through the shared sender. Broadcast audience snapshots are fixed at actual launch;
stop/block suppression survives resume. Authenticated analytics expose contacts, source history,
delivery progress and opaque tracking links with idempotent hit ingestion. Platform owns the editor,
UI/MCP and redirect consumer; cross-application acceptance and production activation remain separate.
`TELEGRAM_MARKETING_ENABLED=false` remains the default. No real funnels or authored copy are
seeded: the current product direction is one owner-authored common funnel; multiple scenarios
exist only in synthetic tests.

## Ordinary `/start` runtime

- `POST /webhooks/telegram` requires an exact `X-Telegram-Bot-Api-Secret-Token`. A valid update is
  acknowledged only after the unique `(bot_identity, update_id)` inbox record commits.
- Updates run in per-user and per-group lanes, in order within a lane and in parallel across
  lanes, so a slow answer for one user does not delay another
  ([ADR 0002](docs/adr/0002-durable-queue-boundary.md)).
- The update worker accepts only private non-bot `/start` commands. Group/channel updates,
  missing or bot senders do not create contacts. Tokenized starts create/reactivate the same
  independent contact even when their token is malformed, unknown, expired, or replayed.
- `BotContacts.observeStart` atomically creates/reactivates the contact, records Contactability
  history, and creates one start-response delivery intent. It stores exact decimal Telegram IDs in
  PostgreSQL and never keys identity by username.
- Private `my_chat_member` block observations preserve the contact and history; a later `/start`
  restores Contactability.
- Delivery records `delivered`, stable Telegram API rejection, retryable Telegram API rejection,
  and unknown transport outcomes as distinct typed attempts. Retries stop after three attempts;
  unknown outcomes retain the diagnosable duplicate risk.
- `GET /health`, `GET /ready`, and `GET /metrics` expose redacted operational signals. Processed or
  terminally failed inbox rows discard the provider payload at once and keep their deduplication
  key and failure class until retention removes them; `src/database/retention.ts` lists every
  expiring technical record and its period.

`TELEGRAM_DELIVERY_MODE=disabled` is the safe default. It still processes starts and creates the
durable welcome intent, but it never calls Telegram. Enabling `live` requires a bot token and the
separate owner gate for external messaging.

## Platform identity-linking contract

- `POST /integrations/platform/v1/identity-links` requires
  `Authorization: Bearer <PLATFORM_INTEGRATION_SECRET>` and an
  `inside.identity-linking.v1` envelope. Platform generates the raw bearer and sends only its
  SHA-256/base64url digest, an opaque Account reference, expiry, and return correlation.
- A raw deep-link token uses only base64url characters, is 43–64 characters long, and expires no
  later than ten minutes after registration. Telegram ingress replaces it with the digest before
  the durable update commit; neither the bearer nor Platform email/raw identifiers enter stored
  link state or the wire response.
- The first valid private `/start <token>` atomically consumes the transaction and records a
  Telegram candidate, but creates no `PlatformLink`, Membership Evidence, entitlement, or access.
  Every tokenized start plans the same neutral link-receipt message, including malformed, expired,
  replayed, and conflicting receipts, so the bot discloses no Account state.
- `POST /integrations/platform/v1/identity-links/:linkTransactionRef/confirm` uses the same Bearer
  credential and requires the original Account reference and return correlation. Outcomes are
  `pending`, `linked`, `idempotent`, `expired`, `malformed`, or `recovery-required`; Telegram-side
  receipt outcomes additionally distinguish `replayed` and `conflict` while the bot response stays
  neutral.
- One Telegram identity remains historically bound to its first Platform Account. Repeating that
  pair is idempotent; attempting the same identity with another Account requires the owner-only,
  explicitly confirmed and immutable-audit recovery described in
  [`docs/operations/owner-identity-recovery.md`](docs/operations/owner-identity-recovery.md).

The executable wire schema and named fixtures live in
[`src/modules/identity-linking/contracts/inside-identity-linking-v1/`](src/modules/identity-linking/contracts/inside-identity-linking-v1/).
The Workspace-owned Membership Evidence schema and fixtures are vendored with a reviewed source
commit and SHA-256 snapshot in
[`src/contracts/inside-membership-evidence-v1/`](src/contracts/inside-membership-evidence-v1/).

## Bot sign-in provider (disabled; website integration pending)

The optional provider proves a private Telegram identity after an explicit confirmation button.
It does not issue a website session or create/merge an Account. The protocol, server-side switch,
and remaining Platform integration gates are in
[`docs/specifications/bot-sign-in-v1.md`](docs/specifications/bot-sign-in-v1.md).

## Initial Membership Evidence

- `TELEGRAM_CANONICAL_CHAT_ID` is required configuration and contains no committed real chat
  identifier. `TELEGRAM_MEMBERSHIP_MODE=disabled` is the safe default; `live` additionally requires
  `TELEGRAM_BOT_TOKEN`.
- A final link confirmation creates one durable initial check. Telegram reads happen in the worker,
  never in Platform confirmation or a content request.
- `creator`, `administrator`, `member`, and `restricted + is_member=true` normalize to `member`;
  `left`, `kicked`, and `restricted + is_member=false` normalize to `not_member`; unknown values,
  API errors, timeouts, or a missing bot administrator prerequisite fail closed as `unavailable`.
- Successful observations atomically allocate a monotonic per-link evidence version. Positive
  evidence expires after five minutes; unavailable results carry no revision or new validity.
- The exact `inside.membership-evidence.v1` envelope enters a durable outbox. Retries reuse one
  `Idempotency-Key` and one durable evidence source (`link_time`, `member_status_event`, or
  `reconciliation`); the production adapter sends that source in
  `X-Inside-Membership-Evidence-Source`. `PLATFORM_EVIDENCE_DELIVERY_MODE=live` requires a separate
  endpoint and Bearer credential.
- A separate Telegram delivery intent reports linked member, non-member, or temporary unavailable
  state without promising content access before Platform accepts the evidence.

## Durable member-status events

- Webhook registration must explicitly use
  `allowed_updates=["message","chat_member","my_chat_member","callback_query"]`; omitted registration is unsafe
  because Telegram excludes `chat_member` from its default set. Old update variants are still
  accepted into the durable inbox and safely ignored by processing.
- Only the exact configured canonical chat can affect Membership. The subject comes from
  `new_chat_member.user.id`; the event actor is never substituted for it and persists only as the
  redacted `actor_is_subject` audit fact.
- Linked subject events use `ChatMemberUpdated.date` as source ordering and `update_id` only as a
  same-second tie-breaker. Successful direct observations and events share one ordering cursor, so
  duplicate, delayed, concurrent, and week-gap/random update IDs cannot roll back a newer current
  observation or its monotonic evidence revision.
- Removal and restriction events issue negative evidence even after a provider degradation.
  Unknown future status is unavailable. A canonical `my_chat_member` demotion immediately marks
  the provider degraded, rejects pending positive evidence observed after the loss, and blocks new
  positive evidence until a newer administrator recovery.
- Unlinked subjects create neither a PlatformLink nor evidence. The durable audit records only
  canonical correlation, normalized disposition, linked/unlinked state, and redacted actor facts;
  processed inbox payloads are discarded as before.

## Durable Membership reconciliation

- Every PlatformLink gets a durable PostgreSQL schedule. The configurable cadence defaults to four
  minutes and cannot be configured at or beyond the five-minute positive-evidence validity.
- Workers claim due links with row locks and recover expired one-minute leases after a crash or
  restart. A batch is bounded by both item count and elapsed time; no user-facing HTTP path runs a
  reconciliation.
- Each check calls the same provider prerequisite, `getChatMember`, normalization, ordering,
  revision, and evidence-outbox pipeline as initial checks. Missed removal and rejoin therefore
  converge without a new link or manual database edit.
- Unavailable Telegram reads and lost administrator capability fail closed, do not advance the
  prior positive observation cursor, and retry with bounded 15–60 second backoff. One failing link
  does not starve later due work.
- Metrics expose only aggregate due count, oldest due age, success/failure/degraded counters, and
  evidence delivery backlog. Telegram IDs, usernames, Account references, tokens, and secrets are
  never metric labels.

## Community entitlements from Platform

- `POST /integrations/platform/v1/community-entitlements` accepts the
  `inside.community-entitlement.v1` command into a durable inbox before it acknowledges anything.
  Its own service secret is required; without one the endpoint answers `401`.
- One desired state per Account carries a monotonic entitlement revision. A lower revision never
  moves it, the same revision with a different desired state is a conflict, and a retried command
  after a lost acknowledgement returns the same durable result.
- Admission creates a short-lived join-request invite and applies only observed membership. Joining
  is approved solely for the intended verified identity in the canonical chat; a foreign or lapsed
  request is declined locally and grants nothing.
- Every external mutation takes a fresh dispatch permit, records its attempt before the call, and
  leases the effect so no second worker repeats it. A lost response stays unknown until a fresh
  observation, and a lost invite is never re-created before its bounded expiry.
- Expiry, revocation and unlink cleanup end community membership without touching paid or manual
  access to materials. Removing a historical identity requires our own historical binding and the
  absence of a transfer; a disputed identity is left to an operator.
- The stored link is bound to its own revision and identity, and is handed out only by `/community`
  in the intended contact's own private chat, and only while community effects are enabled. Handing
  it over is not membership, and the command never starts work of its own.
- Reconciliation re-checks known desired states at least once a minute; an unusable bot or an
  unreachable Telegram becomes `unknown` instead of hiding behind an earlier `applied`.
- `TELEGRAM_COMMUNITY_MODE=disabled` is the safe default. See
  [`docs/integrations/community-entitlements-v1.md`](docs/integrations/community-entitlements-v1.md).

## Durable documents

- [`docs/product/telegram-application-brief.md`](docs/product/telegram-application-brief.md) —
  confirmed product outcome and v1 boundary.
- [`docs/decisions/seed-decisions.md`](docs/decisions/seed-decisions.md) — confirmed decisions and
  unresolved inputs for the next artifact.
- [`GLOSSARY.md`](GLOSSARY.md) — canonical application terminology.
- [`docs/research/telegram-bot-membership-v1.md`](docs/research/telegram-bot-membership-v1.md) —
  official Telegram Bot API and grammY facts plus credentialed proof gaps.
- [`docs/verification/platform-conformance.md`](docs/verification/platform-conformance.md) —
  version compatibility, independent corpus provenance, and the redacted two-application proof.
- [`docs/verification/credentialed-telegram-proof.md`](docs/verification/credentialed-telegram-proof.md)
  — owner wizard entry point and the still-pending real-credential evidence matrix.
- [`docs/specifications/community-and-notifications-v1.md`](docs/specifications/community-and-notifications-v1.md)
  — accepted provider contract for community admission and shared notifications.
- [`docs/integrations/community-entitlements-v1.md`](docs/integrations/community-entitlements-v1.md)
  — implemented endpoint, effect ledger, reconciliation and the limits of this delivery.
- [`docs/operations/owner-identity-recovery.md`](docs/operations/owner-identity-recovery.md) —
  dry-run, exact-confirm transfer, immutable audit, and post-operation verification.
- [Telegram Membership bridge v1 Specification](https://github.com/sachkov-inside/inside-telegram/issues/1)
  — native parent of the approved vertical delivery tickets.

## Delivery

Telegram lives in `apps/telegram` of `sachkov-inside/platform`.
Read [application AGENTS](AGENTS.md), [root AGENTS](../../AGENTS.md) and
[root WORKFLOW](../../WORKFLOW.md). New tasks use the
[Platform tracker](https://github.com/sachkov-inside/platform/issues).
The five open source issues were transferred to Platform; the verified old-to-new map is in
[platform#961](https://github.com/sachkov-inside/platform/issues/961).
Closed source issue URLs remain historical references.

The root CI Gate includes isolated Telegram `check:full` on pull requests, merge groups and
reusable exact-SHA calls. Root [telegram-release.yml](../../.github/workflows/telegram-release.yml)
and [telegram-deploy.yml](../../.github/workflows/telegram-deploy.yml) implement independent
Telegram delivery. The [production runbook](docs/operations/production.md) owns the production
transition evidence and recovery procedure.

## Local development

Install once from the repository root, using its `.node-version` and pnpm pin:

```bash
pnpm install --frozen-lockfile
cp apps/telegram/.env.example apps/telegram/.env
```

Choose a unique Compose project and three unused loopback ports before starting application
infrastructure. The example below uses 25433/25673/35673; change them if they are occupied.
Commands below run from `apps/telegram`:

```bash
export COMPOSE_PROJECT_NAME=telegram-my-task
export TELEGRAM_POSTGRES_PORT=25433 TELEGRAM_AMQP_PORT=25673 TELEGRAM_MANAGEMENT_PORT=35673
export DATABASE_URL=postgresql://inside:inside@127.0.0.1:$TELEGRAM_POSTGRES_PORT/inside_telegram
export NOTIFICATION_TEST_AMQP_URL=amqp://telegram_checks:telegram_checks@127.0.0.1:$TELEGRAM_AMQP_PORT
export NOTIFICATION_TEST_MANAGEMENT_URL=http://127.0.0.1:$TELEGRAM_MANAGEMENT_PORT
pnpm infra:up
pnpm db:migrate
pnpm dev
```

The Compose contract requires an explicit project and ports. It uses a non-guest synthetic RabbitMQ
user. The example `.env` keeps real Telegram delivery disabled. Stop only your owned project with
`pnpm infra:down`; disposable checks may remove their own volumes with `docker compose down --volumes`.

Every entry point loads `.env`, or the file named by `ENV_FILE`, with Node's
`process.loadEnvFile()`. Exported variables win unless `ENV_FILE_OVERRIDE=true`;
production reads its environment from Compose.

## Current verification

From the root, with the owned infrastructure URLs exported above:

```bash
pnpm --filter @inside/telegram check:full
pnpm check
```

Build the Telegram production image from the **root** context:

```bash
docker build --file apps/telegram/infra/production/Dockerfile --build-arg SOURCE_COMMIT=$(git rev-parse HEAD) --tag telegram-local-check .
```

The Dockerfile uses root frozen workspace installation and filtered production deployment.
Root `telegram-release.yml` and `telegram-deploy.yml` implement independent delivery.
The [production runbook](docs/operations/production.md) owns source trust, publication and rollback.

Migration keys are retained across the independently deployed communications and sign-in branches.
Only the independently deployed `010-communications-templates` → `011-communication-funnels`
sequence may cross the sign-in sequence. Both sequences must retain their dependency order;
all other applied migrations must remain an ordered prefix. The shared migrator enforces this under Kysely's migration
lock for up, down and targeted commands. Rollback follows actual application order. PostgreSQL
regressions cover both historical deployment orders, preserve existing data during backfill and
reject a missing dependent sign-in migration. Do not rename applied keys or edit the ledger.

## Application boundary

This application owns Telegram bot identity handling, bot contacts, linking, member-status
updates, reconciliation, normalized Membership Evidence and author communication templates. Platform remains the authority for
Platform Accounts, permissions, entitlements, profiles, and every content-access decision.
