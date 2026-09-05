# Production delivery

Platform separates immutable release publication from production deployment. The release workflow
publishes a closed manifest, a versioned runtime bundle and two digest-addressed images. The deploy
workflow consumes only those exact assets; it does not build from a server checkout or select a
moving tag. GitHub queues production commands, while the host keeps the final exclusive lock and
the successful/failed operation journal.

The [production VPS preparation kit](production-foundation.md) owns the long-lived PostgreSQL,
Logto, backup and system Caddy foundation. This runbook owns the application runtime layered on top
of that foundation. Running its local smoke does not contact or mutate production.

## Runtime topology

`compose.production.yaml` contains exactly seven application processes:

1. `migrations` applies the append-only Platform registry and converges the `pg-boss` schema.
2. `api` serves application HTTP and private operational health.
3. `mcp` serves Streamable HTTP MCP and private operational health.
4. `material-assets-worker` consumes Material Asset cleanup jobs.
5. `profile-avatars-worker` consumes Profile Avatar cleanup jobs.
6. `video-deletions-worker` consumes explicit Kinescope deletion jobs.
7. `web` serves the Next.js application and verifies API readiness.

All seven use the backend or web image digest selected from one `release-manifest.json`. The backend
image is multi-command: its command selects migrations, API, MCP or one worker. PostgreSQL and Caddy
are deliberately absent from application Compose because the foundation owns their lifecycle.

The stack connects three explicit networks:

- `edge` joins the loopback application listeners to the system Caddy;
- internal `application` carries web-to-API traffic;
- external `database` resolves to `FOUNDATION_DATABASE_NETWORK` from the foundation stack.

PostgreSQL is not published. API, MCP and web bind only to `127.0.0.1` on the host. Migrations and
every runtime process use the same non-superuser `platform` database credential. The application
runtime does not create another database role.

## Server-owned configuration

Create the server-owned files once under `/etc/inside/runtime`, replace every placeholder and keep
them owned by `root:root` with mode `0600`. Copy all tracked templates except `runtime.env.example`:

```bash
for template in config/compose/production/*.env.example; do
  [[ "$(basename "$template")" == runtime.env.example ]] && continue
  target="/etc/inside/runtime/$(basename "${template%.example}")"
  sudo install -m 600 -o root -g root "$template" "$target"
done
```

`compose.env` contains only the stable Compose project, network names and loopback ports. The deploy
command generates release identity and exact image variables from the selected manifest under
`/var/lib/inside/deployments`; it never rewrites `/etc/inside/runtime`. The other server files are
delivered only to their named processes:

| File | Required configuration |
|---|---|
| `migrations.env` | shared `platform` database URL |
| `api.env` | database, Logto verifier, Telegram, Object Storage and Kinescope |
| `mcp.env` | database, MCP listener/public URL, Logto verifier, content access, storage and Kinescope |
| `material-assets-worker.env` | database and Object Storage |
| `profile-avatars-worker.env` | database and Object Storage |
| `video-deletions-worker.env` | database and Kinescope |
| `web.env` | internal API URL and Logto BFF |

Each process validates only the groups it owns. Missing owned values stop startup. Provider
reachability is not a global readiness dependency: an external outage degrades its affected flow
without taking unrelated reads or pages out of service.

The release ordinal and source SHA are also embedded in each image at build time as a read-only
`release-identity.json` beside that image's application entrypoint. Startup compares the runtime
values with that file and exits on any mismatch. The image identity is not read from overridable
container environment. Runtime secrets are never image build arguments.

## Deployment order and state

The forced SSH command accepts only `deploy vN <run-id>` or `rollback vN <run-id>` and a streamed
payload containing exactly `release-manifest.json` and `production-runtime.tar.gz`. It verifies the
closed manifest, bundle digest and paths before staging an ordinal under `/srv/inside/releases`.
The host also reads the selected Release from the fixed public GitHub repository over HTTPS,
requires it to be immutable, compares the manifest byte-for-byte and verifies the recorded release
workflow run. GitHub unavailability fails preflight; the SSH key alone cannot supply executable
code. An existing ordinal can be reused only with byte-identical assets.

The gateway bounds the compressed payload to 16 MiB and each decoded tar stream to 32 MiB before
inspection. It accepts only regular files and streams each member into a fixed destination with a
size cap: 1 MiB for the manifest and each runtime file, 16 MiB for the compressed runtime bundle.
Oversized content is rejected before JSON parsing or execution, including highly compressed input.

One deployment executes this order: host/config and current-schema preflight, maintenance route,
exact image pulls, candidate compatibility check, old worker drain, migrations, candidate
processes, release/schema readiness, read-only web smoke, public routes, successful journal write.
`rollback` uses the same order without migrations. Preflight uses the already deployed image with
pulling disabled and rejects database drift while the old route is still public. The runtime schema
identity covers both the Platform migration registry and the PgBoss-managed schema version. A later
failure leaves maintenance active and records its phase for an exact retry or repair forward. The
operation journal retains the last unsafe recovery phase across retry attempts and accepts
both `failed` and abruptly interrupted `running` records for an exact retry. After migrations may
have changed the database, it also accepts only the immediate next ordinal as repair forward. The
next manifest must bind the exact failed release; the failed local
image proves the live schema before the old journal is archived or maintenance is changed. For the
first deployment, an initial preflight asks the already running foundation PostgreSQL container to
prove that the application database has no user tables before the route changes; a same-release
retry after migrations uses the candidate schema proof instead.

`/var/lib/inside/deployments/state.json` records current and previous version, source SHA, image and
bundle digests, schema identity, successful time and GitHub run. `operation.json` records the last
phase, retained recovery phase and `running`/`failed`/`succeeded` status without configuration
values. The server-owned kernel `flock` rejects
overlapping operations even if a caller bypasses the GitHub queue and releases automatically if
its process exits. A repair-forward transition preserves the superseded failed journal as a
root-owned file under `operation-history/`; conflicting history fails closed. Worker shutdown
removes readiness, drains `pg-boss` and releases its process-specific advisory lease before a new
generation starts.
The replacement `operation.json` retains the exact failed version, run and recovery phase under
`repairForward`, allowing the repair candidate itself to be retried after an early or late failure.

## Проверки готовности и маршрутизация

Проверка работающего процесса (`liveness`) отвечает на вопрос «приложение ещё отвечает?».
Например, `/health/live` у API сообщает `status: alive` и сведения о запущенной версии
(`release identity`): номер выпуска `release`, например `v1`, и полный SHA исходного коммита
`sourceSha`. Это ещё не означает, что база готова обслуживать запросы.

Проверка готовности (`readiness`) у API `/health/ready` и MCP `/_health/ready` при каждом
обращении проверяет точный порядок и контрольные суммы миграций Platform, а также версию схемы
`pg-boss` — таблиц очереди фоновых задач. Отсутствующая, изменённая, переставленная или более новая
миграция приводит к отказу. Применяет миграции отдельная команда `migrations`, сама проверка
ничего не исправляет и не записывает в бизнес-данные.

Web по адресу `/_health/ready` требует готовый API с тем же номером выпуска и SHA и возвращает
сведения о его схеме. У фоновых процессов `worker-healthcheck` проверяет служебный файл в памяти
контейнера и заново читает схему базы при каждом запуске. Эти проверки сохраняют прежние гарантии.

В `compose.production.yaml` API и MCP запускают `node healthcheck/http-healthcheck.mjs api`
и `node healthcheck/http-healthcheck.mjs mcp`, web —
`node apps/web/healthcheck/http-healthcheck.mjs web`. Общий исходник находится в
`packages/runtime-identity/http-healthcheck.mjs`; Dockerfile копирует его и схемы версии
в конечные образы. Команда обращается только к `127.0.0.1` внутри своего контейнера и не следует
перенаправлениям. MCP передаёт `Host` из `MCP_SERVER_URL`: например, для
`https://mcp.example.invalid:8443/mcp` это `mcp.example.invalid:8443`, но соединение по-прежнему
идёт на локальный порт `3002`.

Успех требует HTTP 2xx, корректных полей готовности и схемы, а также точного совпадения версии
с непустыми корректными `PLATFORM_RELEASE_VERSION` и `PLATFORM_SOURCE_SHA`. Команда молча
завершается с кодом `0`. При отказе она завершается с кодом `1` и пишет одну короткую причину:
например, `readiness: HTTP 503` — приложение пока не готово,
`readiness: source SHA mismatch` — отвечает другая сборка,
`readiness: invalid JSON response` — ответ не удалось прочитать как JSON,
`readiness: request timed out` — ответ, включая его тело, не получен за три секунды.
Значения конфигурации, полные ответы и тексты исключений не выводятся.

Внутренний предел — три секунды, внешний `timeout` Docker — пять секунд, чтобы причина успела
попасть в журнал. Интервал пять секунд, число попыток и начальный период ожидания не изменены.
Docker отмечает контейнер как `unhealthy`, когда проверка устойчиво не проходит. Это отметка
состояния: `restart: unless-stopped` относится к завершению основного процесса и сама по себе
не перезапускает контейнер из-за `unhealthy`. Команда проверки завершает только свой процесс.

Посмотреть последнее безопасное сообщение у API можно так, передав тот же production Compose
набор переменных, который использовался для запуска:

```bash
docker inspect --format '{{range .State.Health.Log}}{{.Output}}{{end}}' \
  "$(docker compose -f compose.production.yaml ps -q api)"
```

Для ручного чтения служебного ответа с хоста доступны локальные адреса:

```bash
curl --fail --silent http://127.0.0.1:13001/health/live
curl --fail --silent http://127.0.0.1:13001/health/ready
curl --fail --silent http://127.0.0.1:13000/_health/ready
```

The system Caddy imports `infra/production/runtime/platform.caddy`. It publishes only:

- web at `inside.sachkov.dev`;
- `/integrations/telegram/v1/membership-evidence`;
- `/integrations/kinescope/v1/webhook`;
- `/integrations/kinescope/v1/authorize`;
- `/mcp` and `/.well-known/oauth-protected-resource/mcp`.

Unknown `/integrations/*` paths and `/health`, `/health/*`, `/_health/*` return 404 at the public
edge. PostgreSQL and direct service ports remain private. A wrong TLS hostname must fail certificate
validation.

## Migrations, failure and rollback

Schema evolution is forward-only: expand, deploy/backfill while N-1 remains compatible, then remove
old shape in a later release. The test matrix proves a fresh database, upgrade from the previous
schema prefix, a frozen N-1 application query contract against the candidate schema and resume when
execution stops after Platform migrations but before `pg-boss` finishes. Re-running migrations is
the repair path.

Never run an automatic down migration or database restore after a failed application deploy. If
migrations have completed, return to the previous application manifest only when its recorded N-1
compatibility evidence is green. Otherwise keep the database and repair forward. Provider failure
uses the affected feature's disable/recovery path, not a global application rollback.

Repair forward publishes and deploys the immediate ordinal after the failed release. The new
manifest must bind that failed release. Every earlier repair link must resolve to its exact archived
operation and digest-bound manifest, back to the first failed deployment after the successful state
(or failed `v1` without successful state). Missing or conflicting history fails before mutation.
Before accepting the transition, the failed
image proves an exact live schema after completed migrations, or a compatible prefix if migration
execution was interrupted. The new candidate then follows the normal maintenance, pull,
compatibility, worker drain and forward-migration sequence. Its successful state keeps the last
successful application as `previous`, preserves the failed operation in `operation-history/`, and
does not offer rollback to the failed application version. If the repair candidate also fails, its
exact retry uses the linked failed-release schema before its own migrations, or its own compatible
or exact schema proof after migrations may have started. Another immediate ordinal can repair it
forward with the same checked history chain. If `state.json` was successfully written
before a host interruption left `operation.json` unfinished, the exact version and manifest are a
no-op after live-schema and history validation; the retry only closes the operation journal.

The release workflow derives schema identity from the exact candidate backend digest. Starting with
`v2`, it also reads the exact previous manifest and backend digest. The manifest records compatibility
only when both images report the same schema identity. This is deliberately conservative: an
expand-compatible but different schema still requires repair forward until the runtime can prove a
broader contract. A successful deployment opens its rollback window for 24 hours; `v1`, an unknown
target, a changed manifest, incompatible evidence or a new selection after the window expires is
rejected. Once an eligible rollback has passed preflight and entered a mutating phase, its exact
unfinished operation remains retryable after the deadline so maintenance cannot become permanent.

After a successful rollback, deployment may select the ordinal immediately after the recorded
`rolledBackFrom` release: `v1 → v2 → rollback v1 → deploy v3` does not restart `v2`. The `v3` manifest
must bind the exact recorded `v2`, while preflight proves the live `v1` schema and its workers are
drained. The successful state records `v1` as previous but offers no rollback: the publication proof
binds `v2`, not `v1`. If this corrected release fails, its next ordinal uses the same repair-forward
history checks rooted in the rollback state.

Before maintenance, the deployed backend image runs
`node dist/migrations/migrate.js --verify-schema-identity <sha256:identity>` against the
server-owned migration connection, with image pulling disabled. This command never creates a table
or applies a migration: it requires the exact journaled Platform migration prefix and PgBoss schema
version. After maintenance and exact image pulls, `--verify-schema-compatible` accepts an empty
first-deploy database or an ordered, checksum-valid prefix that the candidate can migrate forward.
Drift, gaps and migrations unknown to the image are rejected.

## Run deployment or rollback

The protected `Production` environment owns `PRODUCTION_SSH_HOST`, `PRODUCTION_SSH_PRIVATE_KEY` and
`PRODUCTION_SSH_HOST_KEYS`. #244 creates those external settings and the first immutable release.
To deploy an existing release:

```bash
gh workflow run deploy.yml --ref main --field operation=deploy --field version=vN
```

For rollback, `version` is the exact previous target recorded in `state.json`, for example `v1`
while `v2` is current:

```bash
gh workflow run deploy.yml --ref main --field operation=rollback --field version=v1
```

The workflow uses `concurrency.queue: max`, never cancels the active command, and rechecks the
immutable Release and successful publication run immediately before SSH. A retry uses the same
operation and version. If that immutable release cannot pass after migrations changed the schema,
publish its immediate next ordinal and run `deploy` for that version; the host performs the
repair-forward checks above. Any other operation/version is rejected without replacing the
recovery journal. Do not edit staged release files, `state.json`, `operation.json` or
`operation-history/` by hand.

## Local production proof

The isolated proof builds candidate images once with embedded synthetic identity, then supplies
their exact local image IDs to production Compose. It uses the real foundation PostgreSQL topology
and proves fresh/upgrade/N-1 migrations, `pg-boss` resume, seven-process readiness, no worker
overlap, completion of a controlled in-flight job during graceful drain, trusted TLS, the
positive/negative route matrix and wrong release/schema failure. A before/after database digest
proves that page, route and health smoke creates no application data or provider writes.

```bash
node --test \
  scripts/deployment-workflow-contract.test.mjs \
  scripts/inside-deploy-gateway.test.mjs \
  scripts/production-deployment.test.mjs \
  scripts/production-runtime-bundle.test.mjs \
  scripts/release-rollback-proof.test.mjs
pnpm compose:production:smoke
```

The first command drives `v1 → v2 → retry → rollback` and injected failure phases through a
temporary host filesystem while replacing only Docker, Caddy and HTTP at their system seams. The
Compose proof uses real images, PostgreSQL, networks and worker locks. Both own their resources and
remove them on exit; neither uses production credentials or contacts the production host.

## Publish the next ordinal release

Before publication, configure the repository Actions secret `RELEASE_SETTINGS_READ_TOKEN` with a
fine-grained token scoped to `sachkov-inside/platform` and repository **Administration: read**
(plus GitHub's implicit Metadata read). Use a finite expiry and renew it before it expires. This
credential reads only the repository's immutable-release setting; it cannot change that setting.
The [GitHub settings endpoint](https://docs.github.com/en/rest/repos/repos#check-if-immutable-releases-are-enabled-for-a-repository)
requires this permission, which the standard `GITHUB_TOKEN` cannot request. The token is supplied
only to the two release-planning steps, never to builds, images, production or deploy. The planner
removes it from the environment before all other commands; release history, image publication and
Release creation keep their existing `GITHUB_TOKEN` permissions. Missing or denied settings access,
or disabled immutability, stops publication. Do not substitute a broad personal token for the
workflow token or skip this check.

`.github/workflows/release.yml` remains the sole publication entry point. It captures exact current
`main`, reuses application CI, embeds the ordinal and source SHA in both images, publishes their
public GHCR digests, proves anonymous digest access, validates the downloaded image result against
the canonical contract and captured source before executing that exact backend image, then creates
the immutable GitHub Release with
`release-manifest.json` and `production-runtime.tar.gz`. The manifest binds the bundle digest,
schema identity, successful publication run and exact previous manifest when one exists:

```bash
gh workflow run release.yml --ref main --field version=vN
```

Publishing is not deployment and does not authorize production mutation. The complete local
publication proof remains:

```bash
pnpm release:dry-run
```
