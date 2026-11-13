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
`TELEGRAM_MARKETING_ENABLED=false` remains the default. No real Communication Sequences or authored copy are
seeded: the current product direction is one owner-authored common sequence; multiple scenarios
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
[`docs/contracts/inside-identity-linking-v1/`](../../docs/contracts/inside-identity-linking-v1/).
Membership Evidence shares the repository-local schema and fixtures in
[`docs/contracts/inside-membership-evidence-v1/`](../../docs/contracts/inside-membership-evidence-v1/).
Both applications import `@inside/contracts`; [the shared contract boundary](../../docs/contracts/README.md)
owns updates and independent delivery.

## Bot sign-in provider (disabled; website integration pending)

The optional provider proves a private Telegram identity after an explicit confirmation button.
It does not issue a website session or create/merge an Account. The protocol, server-side switch,
and remaining Platform integration gates are in
[`docs/specifications/bot-sign-in-v1.md`](docs/specifications/bot-sign-in-v1.md).
The flow keeps one bot message: approval sends no receipt, and committed account linking edits
the original prompt. An uneditable sign-in result never creates a replacement message.

## Course Activation and community observations

Course Activation verifies a separate course source and asks Platform to issue lifetime Product Access.
The [portable protocol](../../docs/contracts/subscription-activation-v1/protocol.md) owns exact binding,
receipt compatibility and the ordered route migration. The runtime Module is `course-activation`.
The old membership-evidence bridge, initial checks, reconciliation and outbound evidence workers are removed.
`TELEGRAM_MEMBERSHIP_MODE` and `PLATFORM_EVIDENCE_DELIVERY_MODE` reject every value except `disabled`.
Historical tables and receipts remain passive. Source verification still uses the Telegram membership
reader; actual community member updates still reach `CommunityProvider.observeMembershipEvent`.
Linking/sign-in preserve identity and correlation and create no Product Access automatically.

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
  it over is not membership. With Course Activation enabled, the command follows the
  [Product selection and checked admission rules](docs/operations/course-activation.md#подтверждение-статуса-прежних-участников);
  otherwise reconciliation prepares missing links.
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
Read [application AGENTS](AGENTS.md), [root AGENTS](../../AGENTS.md). New tasks use the
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

Операторский [отчёт участников группы](docs/operations/group-members-report.md) работает
в runtime-образе и показывает участников без привязки или без подтверждённого права
по известным боту ID. Он явно сохраняет неполное покрытие и неизвестные данные.

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

Deployment gateway contracts retain per-case command timings and supervisor lifecycle traces in
`ci-artifacts/telegram-deploy-gateway/`. On a failing case the runner prints the report path.
The report separates payload preparation, gateway execution and process cleanup, and includes
only the changed operation journal's allowlisted phase. It survives temporary host-fixture cleanup;
arguments, environment values, payloads and command output are excluded. A case interrupted before
its command returns retains an `active` boundary and the corresponding raw lifecycle trace.

Identity-linking rollback checks create and drop disposable PostgreSQL databases. The test role
needs `CREATEDB`; the owned Compose and CI PostgreSQL user already has it. These checks never roll
back the shared runtime fixture's tables. Timeout cleanup cancels blocked migration connections before
closing their pools and removing the owned database. Authoring cases cancel only their tagged fixture
connections and join pending work before the next case truncates tables.

## Trainer widget

The Trainer runs inside a Telegram HTML widget ([ADR 0004](docs/adr/0004-trainer-html-widget.md)).
Its source is `src/modules/trainer/widget/widget.css` and `widget.js`; the bot sends the checked-in
`trainer-widget-html.generated.ts`. After changing the source, from the repository root:

```bash
pnpm --filter @inside/telegram trainer:widget:build
pnpm --filter @inside/telegram test:widget
```

The first command rebuilds the generated module and prints the size against the 4 096-byte limit;
`pnpm check` fails when the module is stale or too large. The second command opens the built widget
in Playwright's Chromium with a stand-in `TelegramWidget` and checks every screen at 320, 390 and
430 px. Client-document checks also run in WebKit at 320 and 390 px, with and without a doctype,
and compare positions, sizes, fonts and colours. Checks also protect the timestamp band without a
caption, keep question options stable, and verify compact height and topic pagination. They need `pnpm exec playwright install chromium webkit`
once. The widget browser suite also runs in root
`pnpm check:ui`; Telegram-only `check:full` installs no browser.

`pnpm --filter @inside/telegram trainer:widget:fit <Bank file>` draws every question of a Bank file
in the built widget at 320 and 390 px and reports, by question identifier and in numbers only,
whether its context, question and longest explanation fit; the
[Bank file contract](docs/integrations/trainer-bank-v1.md) describes the output.

For an interactive local review of the actual widget and Trainer with a disposable synthetic Bank,
run `pnpm --filter @inside/telegram trainer:review`. See the
[acceptance guide](docs/operations/trainer-acceptance.md) for the walkthrough and remaining phone checks.

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

## ИИ-модели widget

The ИИ-модели section has a widget of its own under the same rules
([ADR 0004](docs/adr/0004-trainer-html-widget.md)). Its source is
`src/modules/ai-models/widget/widget.css` and `widget.js`; the bot sends the checked-in
`ai-models-widget-html.generated.ts`. The widget only lays out the bot's answers; their shapes and
the fixed words the widget adds are documented in `ai-models-widget-wire.ts`. After changing the
source, from the repository root:

```bash
pnpm --filter @inside/telegram ai-models:widget:build
pnpm --filter @inside/telegram test:widget
```

The first command rebuilds the generated module and prints its size against the 4 096-byte limit,
as Node.js and as Python zlib count it; `pnpm check` fails when the module is stale or too large.
`test:widget` opens the built widget with a stand-in `TelegramWidget` and draws every screen of the
synthetic Справочник at 320 and 390 px in both themes, in Chromium with and without a doctype and
in WebKit without one: no screen is taller than 560 px, overflows sideways or has text below
11 px. It also checks screens whose texts fill the 1 024-byte answer, the navigation (filters,
pages, card tabs, «Лучше взять», «‹», «О данных») and the retry state.

`pnpm --filter @inside/telegram ai-models:widget:fit <Справочник file>` draws every screen of a
Справочник file in the built widget at 320 and 390 px and reports, by widget request and in numbers
only, its height, text size and whether its summaries are cut; the
[import runbook](docs/operations/ai-models-reference.md#проверка-экранов-перед-загрузкой) describes
the output. Run it on the real file before importing it.

## Application boundary

This application owns Telegram bot identity handling, bot contacts, linking, member-status
updates, reconciliation, normalized Membership Evidence and author communication templates. Platform remains the authority for
Platform Accounts, permissions, entitlements, profiles, and every content-access decision.

## Community message capture

`TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED=true` enables capture from `TELEGRAM_CANONICAL_CHAT_ID`.
Capture needs no model-provider key. The bot must receive ordinary group messages through its
Telegram privacy or administrator settings. The owner controls those settings.

`TELEGRAM_COMMUNITY_DISCUSSIONS_TOPIC_IDS` optionally contains a JSON array of positive topic IDs.
Omitting it captures every topic and the general topic. An empty array captures none. Supplying
this setting while capture is disabled fails configuration validation.

## Community discussions

Community intake and daily grouping are opt-in. The [discussion integration](docs/integrations/community-discussions-v1.md)
owns the HTTP protocol, processing, role resolution, retry and retention rules. Set the grouping URL, key and model together
to enable model calls. Leave them absent to collect messages without grouping. Use a separate
`PLATFORM_COMMUNITY_DISCUSSIONS_SECRET` for HTTP and configure the existing Platform author authorization callback.

Voice and video notes keep a Telegram file reference during capture. Set
`COMMUNITY_DISCUSSIONS_TRANSCRIPTION_BASE_URL`, `COMMUNITY_DISCUSSIONS_TRANSCRIPTION_API_KEY`
and `COMMUNITY_DISCUSSIONS_TRANSCRIPTION_MODEL` together to enable transcription before grouping.
The transcription endpoint can differ from the grouping endpoint. Downloads have a 20 MiB limit
and a 30-second deadline. Provider calls have a 120-second deadline and no automatic retries.
Successful transcripts remain cached when grouping fails. Failed transcripts retry during the next daily run.
File bytes remain in memory during transcription; the database keeps the reference and transcript for 90 days.
HTTP discussion reads expose the transcript and its status, including pending and expired voice messages.
