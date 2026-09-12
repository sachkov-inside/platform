# Local development runbook

Docker Compose is the primary local-development contract. A fresh clone needs Docker with Compose,
not host Node.js or a host `node_modules` directory.

## What Compose runs

The default stack contains:

- PostgreSQL 18.4 with a persistent named volume;
- MinIO with separate public-delivery, protected and quarantine buckets; its S3-compatible API is
  on <http://127.0.0.1:9000> and console is on <http://127.0.0.1:9001>;
- one `migrations` job that applies the schema and one `seed` job that adds deterministic
  development data;
- Nest API on <http://127.0.0.1:3001> with health and OpenAPI endpoints;
- the long-running MCP process at <http://127.0.0.1:3002/mcp> over the same application and database
  lifecycle;
- `material-assets-worker`, which consumes the durable `pg-boss` cleanup queue for Material Assets
  and detached Content Covers and has no HTTP listener;
- `profile-avatars-worker`, which consumes the independent durable ProfileAvatar cleanup queue and
  has no HTTP listener;
- `video-deletions-worker`, which owns explicit Platform-uploaded Kinescope Video deletion,
  reference rechecks and bounded retry and has no HTTP listener;
- `billing-worker`, which reconciles saved bank attempts and projects confirmed payments into access grants;
- `bank-double`, the stand's payment provider on <http://127.0.0.1:8090>, where a human chooses the
  outcome of every payment, renewal charge, refund and card binding;
- `logto` and its own PostgreSQL behind the `identity` profile: the stand's sign-in, absent from the
  default stack and started by `pnpm local:stand`;
- `mailpit`, the stand's mail interceptor: SMTP on `mailpit:1025` inside the Compose network, its
  inbox on <http://127.0.0.1:8025>, and no delivery outside the machine;
- RabbitMQ with local TLS, bounded quorum queues and `notifications-worker` for durable transport;
  see [Notifications transport](notification-transport.md) for recovery and the production boundary;
- Next.js web on <http://127.0.0.1:3000>.

The optional Logto email-code proof is a separate, disposable Compose project with isolated ports
and volumes. Its pinned build, automated Management API bootstrap and Mailpit capture are
documented in [`infra/identity/logto/README.md`](../../infra/identity/logto/README.md). Run
`pnpm identity:proof:start`; it starts the shared Platform PostgreSQL, applies normal repository
migrations and runs the application without Logto Console setup. The launcher claims the same
machine-wide ownership lock as `local:setup`, refuses an already running Platform or proof Compose
project, and stops only the environments it claimed when the process exits.

For the destructive, clean-volume #116 security corpus use `pnpm identity:proof:hardening` instead.
It owns different Compose project names and ports, proves the pinned Logto recipient cap, callback
and dependency recovery behavior, verifies one local `Account` and no Platform session table, then
removes only its disposable volumes.

API and web expose real healthchecks. API, MCP and capability workers wait for healthy PostgreSQL
and a successful seed; web waits for healthy API. Storybook is
an optional profile on <http://127.0.0.1:6006>. Integration tests continue to use their own
temporary PostgreSQL and MinIO through Testcontainers and never share the Compose data services.

The production API exposes health, OpenAPI, the published catalog and the Material Reader endpoint.
The local MCP adapter exposes delegated Material, Topic, Series, ordered-composition authoring and
[communications management](../integrations/communications-v1.md)
over production application interfaces;
production Logto client setup and public routing remain separate deployment work.

## Parallel worktrees and singleton ownership

The fixed `inside-platform` Compose project, host ports and PostgreSQL volume are shared by all
worktrees on one machine. At most one worktree or agent session owns them.

Before starting, run:

```bash
docker compose ps
```

Any running service belongs to another session unless the current session started it. Wait for its
handoff; do not rebuild, migrate, stop or reset that stack. The successful starter owns the stack
until that same session runs `docker compose down` and reports the shutdown. Integration tests are
safe in parallel because Testcontainers owns an isolated database.

Playwright does not use Compose. If another worktree owns its default port `3100`, use an available
explicit port such as `PLAYWRIGHT_PORT=3200 pnpm check`; never stop another worktree's process.

## Start from a fresh clone

From the repository root:

```bash
docker compose up --build
```

This one command builds exact Node/pnpm development images, starts PostgreSQL, migrates and seeds
it once, then starts API, MCP and web. Rebuild the affected service after a source, package
manifest, workspace manifest or lockfile change. For a faster edit loop, use the optional host
Node.js commands below.

The checked-in `config/compose/local/*.env` files contain safe container-only development values.
A root `.env` copied from `.env.example` is optional for host-process overrides and Compose host
ports; already exported variables take precedence. Next.js host fallback uses the same checked-in
defaults or variables exported by its launcher shell. Inside the Compose network, applications use
`postgres` and `api` service DNS.
Browser-facing URLs remain on `127.0.0.1`. See the
[runtime configuration contract](runtime-configuration.md) for ownership, precedence, validation,
and the production env-file boundary.

The API creates only the three named local buckets in development mode. Objects use random,
immutable keys and are never written over. The persistent `object-storage-data` volume follows the
same ownership and non-destructive restart rules as PostgreSQL.

Local development uses `KINESCOPE_PROVIDER_MODE=test`. It creates deterministic provider facts for
upload-init, attach, processing reconciliation and playback without a real credential or outbound
Kinescope call; its reserved `.invalid` upload endpoint makes the browser complete the simulated
transfer immediately. Exact Tus and provider callback behavior is covered at the adapter boundary; real
upload/playback acceptance still requires the owner-gated contour described in issue #183. Switch
to `real` only in a private environment with the full Kinescope configuration from
[the runtime contract](runtime-configuration.md); never paste credentials into the repository or
issue evidence.

The test provider also exercises deletion without outbound calls. Operational states and safe
production recovery are documented in the
[Video deletion runbook](video-deletion.md).

For a detached stack suitable for smoke commands:

```bash
docker compose up --detach --build --wait
bash scripts/compose-stack-smoke.sh
```

The smoke proves the live web server adapter can reach API and PostgreSQL, MCP reported
database-backed readiness, one stable free `kak-ustroen-inside-platform` Material with current
stored content, one safe closed catalog Material, and the three seeded offers on the public
storefront. Repeating `docker compose down` and the detached startup preserves the database volume
and proves the development seed remains stable.

Stop without deleting data:

```bash
docker compose down
```

After shutdown, `docker compose ps --all` should list no application containers.

## One stand: sign-in and purchase

One command brings up the whole stand — the application, its workers, sign-in, the bank double and
the mail interceptor:

```bash
pnpm local:stand
```

It builds the images, starts sign-in, configures it with the existing bootstrap and then brings up
the rest of the stand. It prints four addresses at the end:

- the application on <http://127.0.0.1:3000>;
- sign-in on <https://identity.inside.localhost:3301>;
- mail on <http://127.0.0.1:8025>, holding both the sign-in codes and the receipt address codes;
- the bank double on <http://127.0.0.1:8090>.

The default `docker compose up` without the profile starts as before and needs none of this. The
stand claims the same machine-wide lock and the same Compose project as `pnpm local:setup`, so it
refuses to start while a stack is already running: stop the running one with
`docker compose --profile identity down` first. Start the stand only through `pnpm local:stand`;
a bare `docker compose --profile identity up` starts Logto without the bootstrap that configures
it, and sign-in then fails at the token exchange.

Sign-in ports are fixed at 3301 and 3302 on purpose. OIDC compares the issuer as an exact string,
so the address must be the same for the browser and for the application inside the Compose network.

### Owner order

The catalog is already on sale: the development seed publishes the guide and both subscriptions, so
no manual setup is needed before buying. See [Seeded offer catalog](#seeded-offer-catalog).

1. Run `pnpm local:stand` and wait for the four addresses.
2. Open <http://127.0.0.1:3000> and press «Войти». The browser asks about the certificate once:
   sign-in runs over HTTPS with its own root, which is expected — accept the warning.
3. Enter any address such as `you@example.test`. Open the message in <http://127.0.0.1:8025> and
   type its code on the sign-in page.
4. Sign-in offers to connect Telegram. Close that dialog; the purchase does not need it.
5. Confirm the receipt address: «Личный кабинет» → «Покупки» → enter the address → «Получить код».
   The second message lands in the same inbox. An unconfirmed contact refuses the purchase.
6. Buy the guide: open its page, accept the offer, press «Купить». The browser goes to the double's
   payment form; choose «Оплата прошла». Back in «Покупки» the granted right is visible and the
   material opens.
7. Grant yourself the admin surface once. Read the Account identity the sign-in created, then run
   the [owner release bootstrap](#owner-account-release-bootstrap) against the stand:

   ```bash
   docker compose exec -T postgres psql -U inside -d inside \
     -c "select id, logto_subject from accounts.accounts order by created_at desc limit 1"
   docker compose exec -T \
     -e OWNER_LOGTO_ISSUER=https://identity.inside.localhost:3301/oidc \
     -e OWNER_LOGTO_SUBJECT=<logto_subject> \
     -e OWNER_PERMISSION=billing:manage \
     api pnpm --filter @inside/backend release:bootstrap-owner
   ```

8. Classify the account as a new buyer before subscribing. Open `/authoring/billing`, find «Кто
   этот покупатель», paste the Account id from the same row into «Определить Account», set
   «Ожидаемая редакция» to `0` for an account with no decision yet, pick «Новый покупатель» in
   «Состояние», fill «Источник» and «Основание», then press «Записать решение». Without that
   decision the subscription refuses, and the refusal looks like a broken payment although it is
   a sales rule.
9. Subscribe on the storefront. When the guide is already bought, the larger plan asks to confirm
   the overlap with a checkbox — that is intended.

### What to expect

Nothing leaves the machine: the interceptor only receives mail and has no sending node configured.
The bank double moves no money and remembers its orders across restarts.

The stand must not run on previously built images. When migrations or MCP fail with
`Migration ledger is not an exact registry prefix`, the image holds one migration fewer than the
database already applied. Rebuild the stand and **do not wipe the data volume** — it looks like a
corrupted database and is cured by a rebuild.

Wiping `logto-postgres-data` resets the sign-in tenant, and the application keeps the application
id of the tenant that is gone. Run `pnpm local:stand` again: it drops the generated values before
the bootstrap recreates the tenant, so the stand always holds the tenant it just configured.

The generated `.identity-proof/stand.env` outlives `docker compose --profile identity down`, and
`api` and `web` keep reading it. The default stack still starts and still points at the same
sign-in address, because that address is also its built-in local default and nothing answers there
without the stand either way. What the file does carry beyond the defaults are the stand's own
application id, secrets and email fingerprint key, so an Account created on the stand is not the
same Account for a stack running on the fallback values. Start the stand again to get its own back.

## Optional Storybook profile

Start the default stack plus Storybook:

```bash
docker compose --profile storybook up --build
```

The profile uses the same frozen container dependencies as the default stack.

## Optional host Node.js fallback

Use Node.js from `.node-version` and pnpm from `packageManager` only when a faster host loop is
useful:

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm infra:up
pnpm --filter @inside/backend db:migrate
pnpm --filter @inside/backend db:seed
pnpm dev
```

Individual adapters are `pnpm dev:web`, `pnpm dev:api` and `pnpm dev:mcp`. `pnpm local:setup` is a
host-pnpm convenience wrapper around the full detached Compose startup and smoke; it refuses to
reuse a running singleton stack.

### MCP authoring

The MCP adapter uses stateless Streamable HTTP at `MCP_SERVER_URL` (local default
`http://127.0.0.1:3002/mcp`). It verifies a short-lived Logto-compatible bearer token, resolves its
issuer/subject to an existing Account and checks the Account's current `materials:manage`
permission inside each Materials authoring operation. Communications tools independently check
`communications:manage` and a confirmed Telegram link. Provider roles and scopes do not grant
access, and the adapter has no service identity or provider secret.

Owner billing tools `billing_<operation>` are described in
[owner billing operations](#owner-billing-operations); they check `billing:manage`, not
`materials:manage`.

The complete exposed tool set is the generated snapshot `apps/backend/mcp/tool-surface.json`;
`pnpm mcp:check` fails when the registered tools and that snapshot disagree, and `pnpm mcp:generate`
rewrites it. Materials authoring exposes the `material_*`, `content_collection_*`, `guide_*` and
`playlist_*` tools; the Video tools use the same Videos facet as the editor and its current
`materials:manage` check.
`material_save` requires an explicit `primaryVideoId`: preserve the value from `material_load`,
or pass `null` to detach without requesting provider deletion. Older clients omitting the field
receive a validation error instead of silently detaching the Video.
See [the video authoring procedure](video-authoring.md) for exact steps and limits.
Material Save replaces content, metadata, current relations, access
and publication state atomically using `expectedContentVersion`; Series composition Save replaces
the full ordered composition using its optimistic version. Both can affect live content and have no
server-side Undo/history. Preview uses canonical ContentAccess. MCP clients can discover the protected resource
metadata at `/.well-known/oauth-protected-resource/mcp` and send the delegated token in the
`Authorization: Bearer` header. Production provider setup and public routing remain outside this
repository task.

The `playlist_*` identifiers are stable protocol names for Series operations. For `stepGroups`,
composition versions and the Git `step_groups` handoff, follow the
[Series composition contract](../specifications/platform-v1.md#series-step-sequences).
For editorial originals and publication ownership, follow the
[content boundary](../product/platform-mvp-brief.md#контент).

NestJS loads the optional repository `.env` through `@nestjs/config`, validates it with Zod, and
injects one immutable `PlatformConfig`. Next.js validates one server-only `WebRuntimeConfig` during
Node.js server startup. `NODE_ENV=development` enables checked-in local defaults; absent
`NODE_ENV` is production, where all runtime values are required.

Inspect the running host fallback or Compose stack:

- health: <http://127.0.0.1:3001/health>
- OpenAPI UI: <http://127.0.0.1:3001/openapi>
- local S3-compatible endpoint: <http://127.0.0.1:9000>
- local Object Storage console: <http://127.0.0.1:9001>
- MCP Streamable HTTP endpoint: <http://127.0.0.1:3002/mcp>
- MCP protected-resource metadata: <http://127.0.0.1:3002/.well-known/oauth-protected-resource/mcp>
- published Material API: <http://127.0.0.1:3001/materials/kak-ustroen-inside-platform>
- published catalog API: <http://127.0.0.1:3001/library/materials>
- Material authoring OpenAPI group: <http://127.0.0.1:3001/openapi#/Material%20authoring>
- production Library: <http://127.0.0.1:3000/library>
- production Reader: <http://127.0.0.1:3000/materials/kak-ustroen-inside-platform>

The API health response is:

```text
{"process":"api","status":"ready","database":"reachable","release":{"release":"development","sourceSha":"0000000000000000000000000000000000000000"},"schema":{"identity":"sha256:<migration-registry-sha256>","migrationCount":<migration-count>}}
```

`pnpm smoke:health` verifies Nest composition and the documented `tsx watch` API entrypoint.
`pnpm smoke:fullstack` remains the host-process fallback smoke against Compose PostgreSQL; it
starts the API and a production-built web process, verifies the published Reader on desktop and
mobile through Playwright, exercises the server-only adapter against the live API, and uses a
signed delegated owner token to create/reload, publish, Preview and unpublish one stable Material
through the live MCP process.

The identity fixture of that launcher serves a JWKS, a discovery document and a refresh-token grant
on loopback, so a signed-in session can outlive the five minutes of one access token and last the
whole run. The five-minute lifetime itself is unchanged and the API still verifies it; the web BFF
renews the token through its ordinary path, the same one it uses in production. The fixture is a
stand-in, not Logto: it authenticates no client on the token endpoint, never rotates a refresh
token, and serves only the three endpoints it implements. What it does reproduce exactly is the
renewal the application performs and the error shape the application reads, so a refusal is seen as
a signed-out session rather than an unavailable service.

`signInFullStack` in `apps/web/test/support/full-stack-session.ts` checks `/auth/status` right
after setting the cookie, so a session that cannot be renewed fails as an expired session instead
of a missing element, and an unavailable application is named as such instead of being blamed on
the session. `session-lifetime.spec.ts` covers renewal, refusal and that message on a session whose
token has already run out; `scripts/full-stack-identity.test.mjs` covers the grant itself without
starting the stack. Whether the whole suite is free of expiry-driven failures is a property of a
full `pnpm smoke:fullstack` run, not of these checks.

The full-stack launcher also establishes separate active-member, non-member, expired-member and stale-member
Accounts. Confirmed loss of Membership resolves as `expired`; a formerly valid observation accepted
through the normal facet with a historical fixture clock resolves as `stale` at the real clock. The media convergence scenarios exercise one
Material with image, file and primary Video, direct resource denials and an unrouted browser image
cache after sign-out. Kinescope remains the deterministic test adapter; real-provider release
acceptance belongs to #184.

## Repository verification

With pinned host Node.js and pnpm:

```bash
pnpm check
```

This covers lint, strict typecheck, backend architecture guardrails, unit/module/Storybook tests,
Playwright, production builds and the Storybook build without claiming a real database.

```bash
pnpm check:full
```

This adds isolated Testcontainers integration tests and the host full-stack smoke. Stop the full
Compose stack and start only `pnpm infra:up` first, because the host smoke owns ports 3000, 3001 and
3002. This host-process smoke remains a local gate for relevant changes and release candidates; it
does not run on every pull request. Pull requests into `main` run the four-job application and
Docker Compose gate on clean GitHub-hosted runners; see
[Continuous integration](continuous-integration.md) for its job and failure-diagnostics contract.

Run only the real-PostgreSQL backend suite with:

```bash
pnpm test:integration
```

Its disposable Testcontainers database covers create/load/Save, mutable current Materials,
rollback and constraints, idempotency, concurrent stale writes, migration replay and Prisma schema
mapping.

## Inspect PostgreSQL

```bash
docker compose exec postgres psql -U inside -d inside
```

Useful read-only commands:

```sql
\dt materials.*
select position, name, checksum, applied_at
from public.platform_migrations
order by position;
select id, slug, publication_state, content_version, updated_at
from materials.materials
order by created_at;
```

The migration and seed jobs are safe to repeat manually:

```bash
docker compose run --rm migrations
docker compose run --rm seed
```

The seed refuses non-development mode, uses stable idempotency keys, and creates 22 free published
Materials plus one Membership Material whose body remains absent from the public catalog. The free
fixtures cover catalog pagination, Home formats and one explicit Series-reading scenario:
`demo-series-harness` orders a shared guide before a final guide,
`demo-series-review` orders the same shared guide before a video and note, and
`demo-295-samostoyatelnaya-zametka` belongs to no Series. Their titles and summaries identify them
as development examples rather than editorial content. Repeating the seed keeps the same Materials
and upgrades the representative fixture without resetting the named volume. Materials are created
and published through the Materials application interface; only fixed local Topic/Format/Tag/Series
prerequisites use Prisma model operations because Platform has no product taxonomy-authoring
capability yet.

## Migration and Prisma schema checks

With the host fallback database running:

```bash
pnpm --filter @inside/backend db:migrate
pnpm --filter @inside/backend db:schema:check
```

`db:schema:check` validates `prisma/schema.prisma` and regenerates the ignored TypeScript client.
The same generation runs during install, build, and typecheck:

```bash
pnpm --filter @inside/backend prisma:generate
```

The Prisma schema maps the product-owned `billing`, `materials`, `assets`, `accounts`, `member_profiles`,
`membership_entitlements`, `reading_activity`, `notifications` and `telegram_membership` schemas. Checked-in,
append-only SQL migrations remain the database authority. Their explicit positions and checksums
must form an exact registry prefix, rejecting drift, gaps, reordering, and newer unknown migrations;
generated client files are not committed or edited. A pre-Prisma local volume must be recreated
with the destructive reset below rather than supported by application compatibility code.

## Owner Account release bootstrap

After migrations and before serving production traffic, confirm that the owner exists in Logto and
run the explicit idempotent release command with that exact identity:

```bash
OWNER_LOGTO_ISSUER=https://auth.example.com/oidc \
OWNER_LOGTO_SUBJECT=<opaque-logto-subject> \
pnpm --filter @inside/backend release:bootstrap-owner
```

The command ensures one Account and `materials:manage` by default. Explicitly set
`OWNER_PERMISSION=communications:manage` or `OWNER_PERMISSION=billing:manage` to grant only that
management surface instead. It writes
redacted Account audit events including the selected permission,
and prints a JSON summary. It does not run from an application startup hook or public route and does
not need the owner's email. Repeating it reports that no Account or permission was created.

## Manual Member Profile moderation

Use the owner-only release operation to disable or restore the exact Profile by opaque identity
without exposing a public admin route or participant reporting flow:

```bash
PROFILE_MODERATION_ACTION=disable \
PROFILE_PUBLIC_ID=<opaque-public-profile-id> \
pnpm --filter @inside/backend release:moderate-profiles
```

Use `PROFILE_MODERATION_ACTION=restore` with the same `PROFILE_PUBLIC_ID` to restore it. Disable
increments the Profile version and writes redacted audit metadata; the operation never prints
Profile fields, Account identity, Membership evidence or provider data.

## Diagnose prerequisites

`bash scripts/doctor.sh` checks the same Docker-only prerequisites and Compose contract without
requiring host Node.js, pnpm or `.env`. The `pnpm platform:doctor` alias is available only as a
convenience when the optional host toolchain is already installed. Startup reports image,
dependency, health and port failures through `docker compose up` and `docker compose ps`.

Inspect service state and logs with:

```bash
docker compose ps
docker compose logs postgres migrations seed api mcp web
```

If a required port is occupied, inspect its owner and wait for the owning worktree's handoff. Do
not commit machine-specific ports or credentials and do not stop another session's process.

## Destructive reset

Normal shutdown preserves data. Only the current singleton owner may explicitly delete the local
database volume:

```bash
docker compose down --volumes
docker compose up --detach --build --wait
```

This does not affect disposable Testcontainers databases. Never use `--volumes` as routine
shutdown.

## Local editor acceptance

`pnpm editor:local` runs the real editor and API against isolated PostgreSQL at port 54396 and
MinIO at 9036. It refuses production configuration by constructing its own local environment.
Start dedicated containers, separate from the singleton Compose stack:

```bash
docker run -d --name platform-396-postgres -e POSTGRES_USER=inside -e POSTGRES_PASSWORD=inside -e POSTGRES_DB=inside -p 127.0.0.1:54396:5432 postgres:18.4-alpine3.23
docker run -d --name platform-396-storage -e MINIO_ROOT_USER=inside-local-access-key -e MINIO_ROOT_PASSWORD=inside-local-secret-key -p 127.0.0.1:9036:9000 quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z server /data
pnpm editor:local
```

Open `http://127.0.0.1:4396/authoring/materials`. The loopback gateway supplies a synthetic local
owner session using the same identity fixture as the full-stack tests; it refreshes short-lived
credentials server-side. The local Account receives explicit `platform:admin`. No production
identity, permission, credential or provider configuration is read or changed. This proves editor,
BFF, API, persistence and storage behaviour, not real Logto sign-in or Kinescope upload/playback.
The Kinescope test adapter completes uploads without sending the selected video to Kinescope.

Run `pnpm --filter @inside/web exec playwright test --config playwright.editor.config.ts` while
this runtime is running. Stop its launcher before root `pnpm check` because the Next development
server uses one build directory per worktree. Ctrl+C stops the launcher processes; the two dedicated
containers retain local data. Stop only those containers when the review is finished:

```bash
docker stop platform-396-postgres platform-396-storage
```

Do not remove their data or use the shared Compose shutdown command for this isolated runtime.

## Local sale: bank double and mail capture

The stand sells without credentials, without real money and without sending a single message off
the machine. Two services make the sale observable end to end, and both are chosen by configuration
alone: the application keeps one bank adapter and one mail transport.

`config/compose/local/*.env` already set `TBANK_PROVIDER_MODE=test`, so API and `billing-worker`
call the `bank-double` service instead of the bank, and `BILLING_CONTACT_SMTP_*` point at `mailpit`
instead of a provider. `TBANK_CONFIG_JSON` must stay absent in that mode: a real terminal beside the
double is refused at startup.

Pass the purchase in this order:

1. Confirm the receipt address in Account. The code arrives in the interceptor's inbox on
   <http://127.0.0.1:8025>; nothing reaches a real mailbox. An unconfirmed contact refuses the
   purchase, so this step comes first.
2. Buy a guide or a subscription. The application redirects the browser to the double's payment
   form on <http://127.0.0.1:8090>, which is the address the real hosted form would occupy.
3. Choose the outcome on that form. Each button answers exactly as the bank would:

   | Button | Bank status | What the application does |
   |---|---|---|
   | Оплата прошла | `CONFIRMED` | opens the paid rights and saves the card binding when the purchase asked for one |
   | Банк отказал | `REJECTED` | closes the attempt as failed and grants nothing |
   | Покупатель отменил | `CANCELED` | closes the attempt as failed |
   | Истёк срок оплаты | `DEADLINE_EXPIRED` | closes the attempt as failed |
   | Непонятный ответ банка | `CONFIRMING` without success | leaves the attempt unknown for reconciliation, never charges again |
   | Повторить нотификацию | repeats the current status | proves that a repeated notification issues no second grant |

4. Renewal and refund have no buyer-facing form, so their outcome is chosen in advance on the
   double's own page <http://127.0.0.1:8090>: «Следующее списание» decides what `Charge` answers,
   and «Возврат» decides whether the bank accepts `Cancel`. A refund is full or partial according to
   the amount the owner requested, exactly as the bank decides it.
5. Changing a card opens the double's binding form. The new method applies only after the binding
   is confirmed there and `billing-worker` reconciles the session within a minute. A charge against
   a binding the double never issued is declined, so a revoked method stays observable.
6. Cancelling recurring charges asks the bank nothing: the schedule closes locally, the paid period
   stays, and the next renewal is simply never sent.

Pass the guide and both subscription tariffs the same way: the double receives the same request for
each published offer, and only what the purchase asks the bank for differs — a one-time guide never
saves a card, the first subscription payment does, and renewals charge the saved one. The tariffs
themselves differ in price, term or the rights they open, none of which the bank sees. Seeded local offers come from the
development seed.

The double keeps a ledger in its own volume, so restarting it keeps the orders the application may
still have to reconcile; a bank that forgot a payment would strand an unfinished attempt forever.
If the application misses a notification — for example while it is restarting — `billing-worker`
reconciles the same attempt through `CheckOrder`/`GetState` within a minute and settles it without
a second charge. Host processes use the same contour on loopback: `pnpm dev:bank-double` beside
`pnpm dev:api` and `pnpm dev:billing-worker`.

Neither service exists in production. The double refuses to start outside `NODE_ENV=development`,
configuration refuses `TBANK_PROVIDER_MODE=test` and `BILLING_CONTACT_SMTP_LOCAL_CAPTURE=true` in
production mode, and `scripts/production-runtime-contract.test.mjs` fails if the production Compose
or its environment templates mention either of them.

## Subscription payment recovery

`pnpm dev:billing-worker` starts the same recovery process provided by the local Compose service.
It scans durable purchases every minute, reconciles unresolved attempts through CheckOrder/GetState,
and applies the saved entitlement outbox. A failed or unknown Init is never automatically repeated.
The worker and API share the database and one bank contour; its schema is
`apps/backend/src/config/tbank-config.ts`. The contour comes from `TBANK_PROVIDER_MODE`: `test`
builds the local double described in [Local sale](#local-sale-bank-double-and-mail-capture) and
`real` reads `TBANK_CONFIG_JSON`. Without either, payment admission is unavailable.
Use only synthetic bank adapters in automated tests. DEMO configuration on a real test terminal and
production activation belong to #413 and #414 respectively; neither is enabled by the local double.

The JSON configuration requires explicit environment/terminal credentials, a 32-byte base64 encryption
key, receipt tax settings, HTTPS notification and return URLs, amount limits, and confirmation that
the terminal supports recurrent cards and its hosted form exposes only supported cards. The terminal
has one return URL for both outcomes, so point it at `https://<web host>/subscription/return`: that
page reads the authoritative purchase state from the server and never treats the redirect itself as
a successful payment. Keep the
same encryption key available for recovery of saved receipt contacts and recurring bindings. Do not
log the configuration, card binding or receipt email. The callback is
`POST /billing/tbank/notification`; it acknowledges a validated durable result with plain `OK`.

The same process owns the `billing.subscription-notices` queue: three days before a charge it
records the renewal reminder for an active schedule with a usable payment method, issues its next
revision when the date, amount or composition changes, and closes it when the charge is no longer
coming. It records the occurrence only; templates, channels and sending belong to
[Notifications](notifications.md).

The same process owns the `billing.subscription-renewal` queue: it starts due renewals, reconciles
card binding sessions and closes lapsed schedules. A renewal persists its attempt before Init and
records `CHARGE_CALLED` before the network, so a lost response is reconciled through GetState on the
same attempt and never repeated. Cancelling a renewal or revoking a saved method is checked under the
same lock as worker dispatch. Changing a card needs the optional `cardBinding` capability of the
contour with an explicit confirmed check type; without it the operation reports
`method_unavailable` instead of guessing a binding. The local double declares that capability, so
renewal and card change are verifiable on the stand.

The `billing.payment-recovery` queue also reconciles unresolved refunds. A refund attempt is stored
before the bank call and its own identifier travels as `ExternalRequestId`, which the bank treats as
the same request, so reconciliation repeats that identifier instead of sending a second refund. A
lost response keeps the attempt `unknown` and visible to the owner; only a terminal refunded or
reversed status settles it, and only then are the recorded access and renewal decisions applied.

## Seeded offer catalog

The development seed leaves a catalog that can be bought immediately, so a local purchase check
needs no manual setup: subscription «Материалы», subscription «Материалы + сопровождение», and a
one-time purchase of the seeded `platform-inside` Guide. Its prices are deliberately not product
prices, and they live in one place at the top of
`apps/backend/src/development/seed-local-offer-catalog.ts`.

The seed issues the same catalog commands the owner issues in `/authoring/billing`
(`offers.save`, `paymentOptions.save`, `offers.publish`), so command parsing, revision checks and
the catalog's own rules are the real ones. Only the permission decision is the stand's own: the
owner Account is bootstrapped after the seed, so there is nobody to ask yet. A saved offer is
never on sale by default; the seed turns sale on with its own explicit `offers.publish` command.

Each run brings those three offers back to the definition in that file and sends no command at all
when they already match, so repeating the seed never writes a second set. Edit a price there and
the next run applies it — no volume wipe. That cuts both ways: the file owns the name, benefits and
price of its three offers, so renaming or repricing one of them in the admin surface is restored on
the next run. Two things the seed does not touch: an offer the owner created themselves, and the
sale switch of an offer that already exists — turning a seeded variant off to test keeps it off
across runs. When a catalog row cannot be reconciled at all, the seed names it on the console and
moves on rather than failing, because a failed seed stops `api` and `web` from starting.

This is the local stand only. The production catalog and real prices remain an owner decision in
the admin surface, and no demonstration data is seeded there: `seed-local.ts` refuses to run
outside `NODE_ENV=development`, and no production Compose service runs it.

## Owner billing operations

`POST /billing/admin` and the MCP tools named `billing_<operation>` are the same operations behind
one facet, so authorization, idempotency, revision checks and audit are identical. They need the
`billing:manage` permission of the current owner; `platform:admin` includes it. Grant it locally
through the [owner release bootstrap](#owner-account-release-bootstrap) with `OWNER_PERMISSION=billing:manage`.

Reading and previewing repeat freely. Every changing command stores an audit row with the actor,
operation, reason and result, which also acts as its replay receipt: the same payload returns the
original result and a changed payload conflicts.

A local subscription purchase starts only after the owner records who the buyer is. An Account with
no recorded decision reports `unknown`, refuses recurring charges and answers the purchase with
`legacy_review_required`. Read it with `grants.readClassification`, record the decision with
`grants.classify` and its `expectedRevision` (`0` for an Account with no decision yet), or classify
a set through the same `grants.previewBatch` and `grants.applyBatch`. The owner page
`/authoring/billing` performs the same operations under «Кто этот покупатель».

Refund execution is a real external money operation on the real contour and requires
`TBANK_CONFIG_JSON`; without a configured contour the operation reports `method_unavailable`. On the
stand the same command reaches the local double, which returns a full or partial refund according to
the requested amount and moves no money.
Automated tests use synthetic bank adapters only and perform no real refunds or grants.

The first period starts when Inside first verifies and durably records CONFIRMED, whether from a
signed notification or server reconciliation (owner-approved for #407 on 2026-09-09). Delayed
confirmation still gives a full period; duplicate notifications and fulfillment recovery preserve
the original saved bounds. No separate time-policy injection is required. Missing terminal
configuration continues to disable payment admission; DEMO/production activation remains separate.
