# Среды, доставка, выпуск и восстановление Platform v1

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-delivery-recovery.md); текущие правила — [документы Platform](../../README.md).

Статус: исследовательская рекомендация для owner decision и последующего переноса в автономный
repository Platform.

Дата проверки источников: 2026-08-21.

Основание: [Workspace issue #44](https://github.com/sachkov-inside/workspace/issues/44),
[Wayfinder #38](https://github.com/sachkov-inside/workspace/issues/38) и
Platform [`platform-mvp-brief.md`](https://github.com/sachkov-inside/platform/blob/main/docs/product/platform-mvp-brief.md).

## Решение в одном абзаце

Для v1 рекомендуется три постоянные среды без environment branches: локальный Docker Compose,
**staging на отдельном non-production VPS** и production на отдельном VPS. Pull request проходит
CI и UI evidence; merge в `main` один раз строит OCI images, фиксирует их digest'ы в release
manifest и автоматически доставляет ровно этот manifest в staging. Production получает тот же
manifest только после зелёных smoke checks и явного owner GO. Приложение выпускается двумя
slot'ами за Caddy, PostgreSQL меняется отдельным backward-compatible migration job, а штатный
rollback переключает traffic на предыдущий manifest без down migration. Runtime secrets хранятся
в SOPS + age, выдаются контейнерам через Compose secrets и имеют offline recovery recipient.
PostgreSQL архивирует WAL в зашифрованный off-host pgBackRest repository; production readiness
доказывается восстановлением пустого VPS с `RPO <= 1 час` и `RTO <= 4 часа`.

Полные per-PR preview environments в baseline не входят. Если owner review позже потребует
параллельный remote UI, preview создаётся on-demand на non-production host, живёт не более суток,
использует synthetic data и выключенные внешние side effects. Staging остаётся единственным
контуром приёмки реальных callbacks и integrations.

## Границы решения

Подтверждённые входы: `main` — единственная долговечная ветка; Next.js, NestJS/Fastify, worker,
MCP, Logto OSS и PostgreSQL запускаются через Docker Compose; PostgreSQL находится на том же VPS,
что и production application; assets лежат во внешнем S3-compatible storage, видео — в
Kinescope. Покупка VPS, DNS и production deployment не входят в issue.

Этот документ определяет delivery contract и go/no-go gates для будущего Platform repository. Он
не выбирает VPS/S3/telemetry provider и не заменяет application ADR: окончательные image layout,
host bootstrap implementation и migration runner фиксируются там после соответствующих spikes.

## Схема сред

| Среда | Топология и данные | Внешние интеграции | Назначение |
|---|---|---|---|
| Local | Один Compose project на developer machine; disposable PostgreSQL; versioned synthetic seed | Local/sandbox credentials; tunnel только для callback spike | Разработка, unit/integration tests, быстрый vertical slice |
| Staging | Отдельный non-production VPS; тот же Compose shape и PostgreSQL major; отдельные volumes, database roles, secrets и buckets | Отдельные Logto application/instance, S3 principal, Kinescope project и test bot/provider account, когда provider это поддерживает | Автоматический deploy из `main`, migration rehearsal, owner UI/integration acceptance, host-bootstrap rehearsal |
| Production | Один production VPS; два application slot'а за host-level Caddy; один PostgreSQL cluster | Только production credentials, exact callbacks и domains | Пользовательский traffic и канонические данные |
| Preview, optional | Уникальный Compose project `pr-<number>` на non-production host, отдельная database и TTL cleanup | Side effects off; exact callback registration только по необходимости | Параллельный remote UI review, не release gate |

Staging на production VPS дешевле, но разделяет CPU, RAM, disk и failure domain, поэтому может
сломать production именно в момент проверки. Он также не доказывает bootstrap нового host.
Отдельный VPS — намеренная стоимость за stable callbacks, owner acceptance и честный recovery
drill. Это особенно существенно для Logto OSS: официальный self-host baseline сам требует
заметного ресурса, поэтому non-production host следует sizing'овать по измеренному полному stack,
а не называть «маленьким» заранее
([Logto OSS](https://docs.logto.io/logto-oss)).

### Сравнение вариантов и расходов

| Вариант | Постоянный расход | Изоляция и callbacks | Решение |
|---|---|---|---|
| Local + production | Один production VPS и его backup/telemetry | Нет remote pre-production acceptance; реальные callback changes проверяются слишком поздно | Отклонить |
| Staging на production VPS | Дополнительные RAM/disk/operations без второго VPS | Отдельные Compose/DB/secrets, но общий host и blast radius | Только временный fallback после capacity test и явного owner acceptance риска |
| Staging на отдельном VPS | Ещё один VPS, non-prod bucket и telemetry ingest; возможны provider test-plan расходы | Отдельный host, stable exact callbacks, recovery rehearsal | **Baseline v1** |
| Постоянные per-PR previews | Ресурсы растут как число активных PR; нужен provision/TTL/callback control plane | Лучшая параллельность, самая сложная isolation/cleanup модель | Не включать в baseline |

Месячный budget считается до procurement как:

```text
production VPS
+ non-production VPS
+ pgBackRest bytes + WAL/day × retention + restore egress
+ assets version history
+ off-host telemetry ingest/retention и synthetic probes
+ платные non-production tenants внешних providers
+ часы временного production-class VPS для isolated recovery drill
```

Preview не должен неявно увеличивать bill: одновременно разрешён один preview в пределах
измеренного non-production capacity; следующий ждёт или требует отдельного owner-approved budget.
Конкретные суммы нельзя честно назвать до выбора provider, region, disk class, retention и
фактического WAL/telemetry volume. Реализация обязана иметь cost alert и ежемесячно сверять
измерения с этой формулой.

## Domains, callbacks и тестовые данные

Используются stable exact hosts; реальные имена владелец выбирает до bootstrap:

| Контур | Web/API/Auth | Callback policy |
|---|---|---|
| Production | `app.<domain>`, `api.<domain>`, `auth.<domain>` | Exact redirect, post-logout, webhook и Kinescope authorization URLs; Logto Admin не публикуется либо закрыт отдельным operator access |
| Staging | `staging.<domain>`, `api.staging.<domain>`, `auth.staging.<domain>` | Отдельные exact URIs и callback secrets; production endpoints не используются |
| Local | Фиксированные `localhost` ports | Sandbox или временный tunnel, который никогда не попадает в production config |
| Preview | `pr-<n>.preview.<domain>` | По умолчанию mock/disabled adapters; exact URI создаётся и удаляется вместе с preview |

Logto проверяет redirect URI по allow-list. Wildcard patterns поддерживаются для dynamic
environments, но сами docs предупреждают, что это не стандарт OIDC и увеличивает attack surface,
поэтому wildcard не является v1 shortcut
([Logto application data](https://docs.logto.io/integrate-logto/application-data-structure)).
Kinescope authorization backend и embedding allow-list также настраиваются по environment:
production player не должен обращаться в staging, а закрытое видео обязано проходить production
access check
([Kinescope authorization backend](https://docs.kinescope.com/developer-guides/authorization-backend/),
[embedding domains](https://docs.kinescope.com/catalog-and-video-management/media-file-settings/)).

Local/staging/preview получают только idempotent versioned seed fixtures: anonymous, free member,
active member, expired member, owner, public/private material, failed callback, queued/retried job
и asset/video fixtures. Email использует reserved test domains; provider payloads не содержат live
credentials. Production dump и PII запрещены вне production. Настоящий backup допустим только в
изолированном recovery drill с production-class access controls и обязательным уничтожением среды.

## Release unit и CI

После merge в `main` GitHub Actions строит images один раз. Human-readable tag `sha-<git-sha>`
служит навигацией, но Compose и release manifest используют `image@sha256:<digest>`: Docker Compose
поддерживает digest в OCI image reference, а GHCR рекомендует digest, чтобы всегда получать тот же
image
([Compose services](https://docs.docker.com/reference/compose-file/services/),
[GHCR pull by digest](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#pull-by-digest)).

Release manifest — non-secret immutable artifact со следующими полями:

```yaml
release_id: <UTC timestamp>-<short sha>
git_sha: <full sha>
images:
  web: ghcr.io/...@sha256:...
  platform: ghcr.io/...@sha256:... # api/worker/mcp/migrate commands
migration_head: <id>
compose_revision: <sha256>
config_schema: <version>
built_at: <UTC timestamp>
build_run: <GitHub Actions URL>
```

Manifest публикуется рядом с images как off-host release artifact, копируется на staging и
production и сохраняется в recovery repository. Между средами запрещены rebuild, tag resolution
и замена manifest. BuildKit добавляет provenance и SBOM; build secrets передаются secret mounts,
не build args, потому что provenance может раскрыть неправильно переданные arguments
([Docker attestations](https://docs.docker.com/build/ci/github-actions/attestations/)).

### Pull request gates

| Gate | Проверка | Evidence |
|---|---|---|
| Source | frozen lockfile, lint/format, TypeScript typecheck, unit/domain tests | CI logs |
| Contracts | OpenAPI/MCP/generated types актуальны, generated diff пуст | checked-in contract diff |
| Database | migrations с нуля; latest released schema -> candidate; deterministic seed; integration tests с реальным PostgreSQL | migration ledger и test report |
| Rollback compatibility | previous released application запускается на candidate schema; destructive DDL отсутствует либо вынесен в отдельный approved plan | `N-1 app + N schema` smoke |
| Runtime | production images build; `docker compose config -q`; isolated Compose поднимается с healthchecks через `up --wait` | digest'ы и smoke report |
| Journeys | public page/API, login test adapter, DB read/write, queue -> worker, MCP read, S3 synthetic operation | machine-readable smoke report |
| Security | secret scan, dependency/image scan, минимальные `GITHUB_TOKEN` permissions; external Actions pinned на full commit SHA | CI policy/report |
| UI change | mobile и desktop evidence по Platform Definition of Done | PR screenshots/trace |

`docker compose config` разворачивает и валидирует фактическую merged model, а `up --wait` ждёт
состояния running/healthy
([Compose config](https://docs.docker.com/reference/cli/docker/compose/config/),
[Compose up](https://docs.docker.com/reference/cli/docker/compose/up/)). Third-party Actions
фиксируются полным commit SHA — GitHub называет это единственной immutable ссылкой на Action
([GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions)).

## Promotion и owner acceptance

Deployments сериализуются отдельными concurrency groups `deploy-staging` и `deploy-production`;
GitHub прямо поддерживает concurrency как способ оставить один deployment среды в работе
([GitHub deployments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)).
GitHub-hosted runner подключается по SSH к restricted deploy user и вызывает один versioned host
script; production VPS не является постоянным self-hosted Actions runner. Runtime secrets runner
не получает.

### Staging

1. Получить manifest, взять environment lock, проверить disk/RAM, secret generation, DNS и
   expected current release.
2. Pull всех exact digest'ов, проверить manifest checksum и `docker compose config -q`.
3. Создать pre-migration restore point staging, выполнить один `migrate` container и сохранить
   migration ledger.
4. Поднять candidate slot через `docker compose up -d --wait`, выполнить internal smoke, затем
   переключить staging Caddy.
5. Выполнить external synthetic journey и опубликовать owner URL, release ID и evidence.

Любой новый staging manifest отменяет предыдущую приёмку. Owner принимает точный release ID:

| Поверхность | Обязательная проверка |
|---|---|
| UI | desktop/mobile, public/member/owner states, loading/empty/error, draft/preview |
| Identity/access | email sign-in/logout, active/expired Membership, denied closed material, Logto callback/issuer |
| Content/assets | draft -> validation -> preview, upload/download, public/private S3 access |
| Video | Kinescope allow/deny playback и authorization callback |
| Async/integrations | callback fixture, idempotency, queue -> worker, retry/DLQ и side-effect kill switch |
| Agent path | MCP read/write validation; publish остаётся за owner GO |

### Production

1. Owner явно выбирает уже принятый `release_id`. Если GitHub plan поддерживает required reviewer
   для private repository, используется protected `production` Environment. Иначе gate —
   owner-triggered `workflow_dispatch` с release ID и подтверждением `GO`; availability нельзя
   предполагать, потому что required reviewers в private repositories ограничены планом
   ([GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#required-reviewers)).
2. Deploy script берёт lock и останавливается, если staging evidence не относится к этому manifest,
   backup/WAL stale, есть critical alert, недостаточно disk/RAM либо schema drift.
3. Сохранить current manifest как rollback target, создать PostgreSQL restore point и подтвердить
   его WAL в off-host archive.
4. Pull exact digest'ов. Выполнить единственный migration job из candidate platform image; app
   startup никогда не auto-migrate.
5. Запустить inactive web/API/MCP slot без worker, дождаться readiness и выполнить direct smoke.
6. Валидировать Caddy config и graceful reload на новый upstream; затем остановить старый singleton
   worker и запустить новый. Старый application slot остаётся готовым в rollback window.
7. Выполнить public smoke, queue/integration canary и 30-минутное observation window. Только после
   этого пометить release успешным; предыдущий slot удалить после 24 часов и успешного следующего
   backup.

Caddy должен работать как host-level systemd edge с persistent data directory и admin endpoint,
доступным только локально. Он автоматически выпускает/обновляет TLS при корректных DNS и ports,
а `caddy reload` применяет config graceful и оставляет старую config при ошибке
([Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https),
[Caddy reload](https://caddyserver.com/docs/getting-started#reloading-config)).

Blue/green применяется только если capacity test доказывает одновременный footprint двух
application slot'ов плюс PostgreSQL/Logto и worker handoff. Если gate не проходит, v1 явно
принимает короткое Compose recreate window; это безопаснее, чем имитировать zero downtime на
перегруженном host. Второй production database не создаётся: оба slot'а используют одну
backward-compatible schema.

## Migration contract и feature flags

Checked-in immutable migrations и один runner являются authority. Production deploy запускает их
отдельным job; schema push, startup migration, ad-hoc DDL и второй migration ledger запрещены.
Нормальный цикл — expand -> deploy/read-write both -> bounded backfill -> observe -> contract в
отдельном более позднем release после окончания rollback window.

- rename выполняется как add/copy/switch/drop, а не одним destructive statement;
- `NOT VALID`/поздний `VALIDATE` и `CREATE INDEX CONCURRENTLY` используются только после проверки
  lock/runtime characteristics; concurrent index имеет отдельный non-transactional recovery path;
- migration задаёт `lock_timeout`, оценивает table scan и не держит внешние I/O внутри transaction;
- candidate schema обязана принимать previous application manifest;
- down migration разрешена только если заранее доказана на production-shaped copy и не теряет
  post-deploy writes. Иначе выполняется forward repair.

PostgreSQL обычно требует `ACCESS EXCLUSIVE` для `ALTER TABLE`, если конкретная форма не говорит
об обратном, а `CREATE INDEX CONCURRENTLY` нельзя запускать внутри transaction block
([`ALTER TABLE`](https://www.postgresql.org/docs/current/sql-altertable.html),
[`CREATE INDEX`](https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)).

Feature flags server-side, environment-scoped и audit'ятся. v1 нужны два вида: release flags для
нового user path и kill switches для external email/Telegram/Kinescope/MCP writes и worker
consumers. В staging внешние side effects выключены по умолчанию. Flag не заменяет migration
compatibility, access control или test; stale release flag удаляется отдельной задачей.

## Штатный rollback

| Симптом | Действие | Database |
|---|---|---|
| Ошибка до Caddy switch | Остановить candidate slot, release failed | Schema остаётся совместимой; при необходимости forward repair |
| UI/API/auth regression после switch | Kill switch при наличии, Caddy -> previous slot, worker/MCP -> previous digest, smoke | Не down-migrate |
| Ошибка worker/external provider | Выключить consumer/side effect, вернуть previous worker, повторить idempotent jobs после fix | Сохранять inbox/outbox state |
| Неправильные данные при совместимой schema | Остановить writer, исправить forward script из audit/event source | PITR не применять автоматически |
| Destructive migration/corruption | Incident, stop writes, restore отдельного cluster до выбранной точки, owner решает допустимую потерю | Whole-cluster PITR |
| Потерян VPS | Empty-VPS recovery runbook | pgBackRest restore + WAL replay |

### Исполнимый app rollback

1. Объявить rollback выбранного `release_id`, взять `deploy-production` lock, запретить следующий
   deploy и зафиксировать failed release, alerts и время начала. При access leak или опасных
   external side effects сначала включить соответствующий kill switch.
2. Получить сохранённый previous manifest; проверить checksum, наличие всех digest'ов в registry и
   зелёный CI gate `previous app + current schema`. Если compatibility evidence отсутствует,
   image rollback запрещён: consumers остаются paused, выполняется forward repair либо отдельный
   data incident.
3. Проверить старый slot или пересоздать web/API/MCP из previous digest'ов без worker. Дождаться
   internal readiness и выполнить direct public/auth/access smoke на slot address.
4. Валидировать Caddy config и graceful переключить upstream на previous slot. Немедленно выполнить
   external HTTPS, public/member/owner access и closed-content denial smoke. Если previous slot не
   проходит их, вернуть последний working upstream и эскалировать rollback в incident.
5. Остановить failed worker. Previous worker запускается только когда его queue-payload и current
   schema compatibility доказаны; иначе consumers остаются paused до forward-compatible worker.
   MCP writes и external callbacks включаются по одному после idempotency check.
6. Записать previous manifest как current, выполнить queue/provider canary и наблюдать те же
   error/latency/auth/queue signals 30 минут. Rollback завершён, когда critical alerts отсутствуют,
   release/schema telemetry согласованы и owner подтвердил critical journey.
7. Сохранить failed slot/logs для diagnosis, создать corrective issue и оставить database schema
   без автоматической down migration. PITR начинается только отдельным owner-controlled incident,
   если доказана corruption и принята потеря post-target writes.

Автоматический rollback запускается при failed readiness/smoke до или сразу после switch. После
появления новых пользовательских writes rollback остаётся owner-controlled: traffic switch
обратим, но повтор external side effects и data repair требуют incident evidence. Critical trigger:
ошибка auth/access, утечка закрытого контента, migration failure, устойчивый рост 5xx/latency,
неработающий worker/callback либо невозможность подтвердить backup/WAL freshness.

## Secrets и bootstrap

Механизмы разделяют роли:

| Механизм | Что хранит | Граница |
|---|---|---|
| GitHub Environment secret | Только staging/production deploy SSH identity и notification credential | Доступен hosted runner; не runtime store |
| SOPS + age | Отдельные encrypted runtime manifests `nonprod` и `production` | Versioned ciphertext; минимум host и offline owner recipients |
| Docker Compose secret | Расшифрованный file конкретному service в `/run/secrets` | Last mile; source file должен оставаться защищённым на host |

SOPS поддерживает несколько age recipients и rotation через `updatekeys`; project хранит public
recipients и ciphertext, а не private identity
([SOPS](https://github.com/getsops/sops)). Compose secret явно выдаётся только перечисленным
services; приложение поддерживает `*_FILE`/path config
([Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)).

На host SOPS расшифровывает generation в root-only tmpfs `/run/inside/secrets/<generation>` с
directory mode `0700` и files `0400/0600`. После smoke новой generation consumers пересоздаются,
старый provider credential отзывается, затем старая generation удаляется. Production и non-prod
не делят DB passwords, cookie/signing keys, S3 principals, callback secrets, API tokens или backup
credentials.

Offline break-glass packet находится вне GitHub, обоих VPS и backup bucket. Он содержит owner
recovery для VPS/DNS/GitHub, offline age identity, backup repository access и cipher passphrase,
Logto `SECRET_VAULT_KEK`, approved release manifest, domain/callback inventory и контакты внешних
providers. Потеря `SECRET_VAULT_KEK` ломает расшифровку Logto Secret Vault, поэтому ключ является
обязательным recovery input
([Logto deployment configuration](https://docs.logto.io/logto-oss/deployment-and-configuration)).

Rotation всегда идёт add -> deploy -> smoke -> revoke; break-glass use создаёт incident record.
Plaintext secret не записывается в GitHub Actions artifact/log, image layer, Compose config output,
telemetry или backup вне зашифрованного repository.

## Наблюдаемость и release blockers

Day-one contract:

- JSON stdout logs с `timestamp`, `severity`, `service`, `environment`, `release_id`, `request_id`,
  `trace_id`, `duration`, `result` и безопасным error code; bodies, cookies, auth headers, tokens,
  DB URLs и прямые PII не логируются;
- bounded Docker log rotation; default `json-file` без `max-size` не ограничен
  ([Docker logging](https://docs.docker.com/engine/logging/drivers/json-file/));
- metrics: host/filesystems, container health/restarts, HTTP rate/error/latency, DB pool и
  `pg_stat_archiver`, queue age/depth/retry/DLQ, worker heartbeat, external dependency errors,
  migration/release version, backup/WAL freshness;
- один lightweight OpenTelemetry/Prometheus-compatible collector на каждом VPS отправляет
  telemetry в off-host backend; OpenTelemetry Collector принимает и экспортирует traces, metrics
  и logs vendor-neutral способом
  ([OpenTelemetry Collector](https://opentelemetry.io/docs/collector/));
- отдельный off-host black-box probe проверяет public HTTPS и synthetic critical journey, а alert
  receiver находится вне production failure domain.

`/health/live` отвечает только за живость процесса. `/health/ready` проверяет обязательную local
dependency и expected schema/release, но не делает весь service unavailable из-за необязательного
external provider. Deep integration checks и side effects живут в отдельном authenticated
synthetic journey. Compose healthcheck определяет healthy state; dependency с
`condition: service_healthy` действительно ждёт этот check
([Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/)).

Обязательные alerts и blockers:

| Signal | Warning | Critical / deploy blocker |
|---|---:|---:|
| Public/synthetic probe | один failed check | failed 2-5 минут |
| TLS expiry | < 21 дня | < 7 дней |
| Root/PostgreSQL/Docker filesystem free | < 20% | < 10% либо forecast full < 4 часа |
| Последний archived WAL | > 20 минут | > 30 минут или растёт `failed_count` |
| pgBackRest | backup позже schedule + grace | `check`/`verify` failed, repository недоступен |
| Queue/worker | oldest age выше product SLO | DLQ > 0 или два heartbeat interval без worker |
| Release/schema | version mismatch | migration/readiness/smoke failed |
| Alert path | heartbeat late | heartbeat отсутствует через независимый канал |

`pg_stat_archiver` даёт timestamps и counters успешной/неуспешной архивации
([PostgreSQL monitoring](https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-ARCHIVER-VIEW)).
Порог 30 минут оставляет operational margin до RPO 1 час; он не доказывает RPO без restore drill.

## Recovery boundary всей системы

| Authority | Что восстанавливает | Механизм |
|---|---|---|
| Git/OCI release artifacts | Compose/Caddy/collector config, bootstrap, migration history, exact images | Clone pinned commit + pull approved manifest by digest |
| SOPS ciphertext + offline packet | Runtime/provider credentials, callback inventory, Logto KEK | Offline age identity -> root-only tmpfs |
| PostgreSQL cluster | Platform и Logto databases, roles и transactional state | pgBackRest base/diff/incr + continuous WAL/PITR |
| External asset bucket | Images/files и их previous versions | Immutable keys, bucket versioning и tested object restore |
| Kinescope | Provider video files | Provider project plus platform manifest/IDs; provider recovery/export becomes #42 hard gate |
| Off-host telemetry | Incident evidence и black-box status | Managed/off-host retention independent of lost VPS |

pgBackRest не защищает external assets. S3-compatible provider обязан доказать versioning и restore
предыдущей версии; S3 Versioning сохраняет previous versions при overwrite/delete, но каждая
version тарифицируется отдельно
([AWS S3 Versioning](https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html)).
Bucket lifecycle не может удалять noncurrent versions раньше approved recovery window. Object Lock
для backup repository не включается автоматически: WORM retention может конфликтовать с
pgBackRest expiration, поэтому его проверяют отдельным provider spike.

## PostgreSQL backup и PITR

### PostgreSQL-рекомендация

Для единственного production VPS нужен один зашифрованный pgBackRest repository во внешнем
S3-compatible object storage. Локальная копия на том же VPS не считается backup от потери VPS.
PostgreSQL непрерывно отправляет WAL через `archive_command`; full/diff/incr backup'ы уменьшают
объём копирования и время replay, но сами по себе не задают RPO. PostgreSQL прямо описывает PITR
как сочетание filesystem-level backup с непрерывной последовательностью WAL и требует, чтобы эта
последовательность начиналась не позже начала выбранного backup'а
([PostgreSQL: Continuous Archiving](https://www.postgresql.org/docs/current/continuous-archiving.html)).

Цели принимаются только по результату drill:

- **RPO <= 1 час:** в восстановленном cluster самая свежая подтверждённая запись не старше 60
  минут относительно момента имитированной потери VPS.
- **RTO <= 4 часа:** от объявления потери VPS до готовности восстановленного PostgreSQL принимать
  production workload, включая проверку данных и application smoke check, проходит не более 4
  часов.

Настройка `archive_timeout` ограничивает возраст незавершённого WAL segment, но не гарантирует
RPO при недоступном S3, ошибочной конфигурации или переполнении `pg_wal`. Поэтому конфигурация,
проверки repository и recovery drill являются одной системой, а не независимыми опциями.

## Базовая конфигурация

Шаблон фиксирует форму, а не реальные пути, endpoint или credentials:

```ini
# postgresql.conf
archive_mode = on
archive_command = 'pgbackrest --stanza=platform archive-push %p'
archive_timeout = '5min'
```

`archive_command` вызывается только для завершённых WAL segments; при слабой нагрузке
`archive_timeout` принудительно переключает segment. PostgreSQL предупреждает, что слишком малое
значение раздувает archive storage; пять минут оставляет большой запас до RPO 1 час без попытки
сделать WAL archive механизмом синхронной репликации
([PostgreSQL: WAL archiving и `archive_timeout`](https://www.postgresql.org/docs/current/runtime-config-wal.html#RUNTIME-CONFIG-WAL-ARCHIVING)).

```ini
# pgbackrest.conf; placeholders must be supplied outside version control
[platform]
pg1-path=<PGDATA>

[global]
repo1-type=s3
repo1-path=/platform/postgresql
repo1-s3-bucket=<bucket>
repo1-s3-endpoint=<endpoint>
repo1-s3-region=<region>
repo1-s3-key=<access-key>
repo1-s3-key-secret=<secret-key>
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=<independently-recoverable-random-passphrase>
repo1-retention-full=4
repo1-bundle=y
repo1-block=y
spool-path=/var/spool/pgbackrest
start-fast=y

[global:archive-push]
archive-async=y
process-max=2
```

Также нужен локальный `spool-path`, принадлежащий пользователю PostgreSQL. pgBackRest поддерживает
S3-compatible repository и требует заранее создать bucket; endpoint, region и URI style следует
проверить на выбранном provider
([pgBackRest: S3-compatible object store](https://pgbackrest.org/user-guide.html#s3-support)).
TLS certificate verification включена по умолчанию и не должна отключаться в production
([pgBackRest: `repo-storage-verify-tls`](https://pgbackrest.org/configuration.html#section-repository/option-repo-storage-verify-tls)).

`archive-async=y` полезен для latency object storage: pgBackRest отправляет готовые segments
параллельно, но возвращает PostgreSQL success только после безопасной записи требуемого segment в
archive. Spool содержит status, а не единственную копию WAL
([pgBackRest: asynchronous archive-push](https://pgbackrest.org/user-guide.html#async-archiving/async-archive-push)).
Начать следует с небольшого `process-max` и увеличить его только по измерениям, чтобы backup не
вытеснил production I/O.

pgBackRest шифрует repository client-side с `aes-256-cbc`, в том числе если object storage имеет
собственное encryption at rest
([pgBackRest: repository encryption](https://pgbackrest.org/configuration.html#section-repository/option-repo-cipher-type)).
Потеря `repo1-cipher-pass` равна потере backup, поэтому recovery drill обязан получать passphrase
не с восстанавливаемого VPS. Access key должен быть ограничен одним bucket/prefix; детали хранения
и ротации credentials относятся к отдельной части issue #44.

## Backup и retention

Начальный schedule для небольшой Platform:

| Операция | Частота | Назначение |
|---|---:|---|
| `--type=full backup` | еженедельно, воскресенье | Независимая база цепочки |
| `--type=diff backup` | ежедневно, понедельник-суббота | Копия изменений от последнего full; короткий restore chain |
| `--type=incr backup` | каждые 6 часов между daily backup'ами | Копия изменений от предыдущего backup; меньше данных для restore |
| `archive-push` | непрерывно | Фактический механизм RPO и PITR между backup'ами |

pgBackRest определяет full как независимый backup, diff как изменения после full, а incr как
изменения после любого предыдущего backup; для restore incr нужны все его зависимости
([pgBackRest: backup concepts](https://pgbackrest.org/user-guide.html#concept/backup)). Официальный
пример планирует weekly full и daily diff через cron; у pgBackRest нет встроенного scheduler
([pgBackRest: schedule a backup](https://pgbackrest.org/user-guide.html#quickstart/schedule-backup)).
В production лучше отдельные systemd timers с единым lock, запретом параллельных backup jobs и
явной проверкой exit code.

Начальная retention policy: `repo1-retention-full=4`, не задавать отдельные
`repo1-retention-diff` и `repo1-retention-archive`. Тогда diff/incr живут вместе со своим full, а
WAL по умолчанию сохраняется для неистёкших backup'ов. Incremental backup не имеет собственной
retention и удаляется с зависимым full/diff
([pgBackRest: retention](https://pgbackrest.org/user-guide.html#retention)). Это даёт примерно
трёх-четырёхнедельное PITR window при weekly full без риска случайно укоротить его более агрессивной
WAL retention. После четырёх недель нужно пересчитать policy по фактическим размерам full/diff/incr,
суточному WAL, длительности restore и стоимости S3; pgBackRest также рекомендует оценивать capacity
по измеренным backup sizes и WAL/day
([pgBackRest: create repository](https://pgbackrest.org/user-guide.html#quickstart/create-repository)).

## Проверка backup'ов

Наличие объектов в bucket не доказывает recoverability. Минимальный режим:

1. После первоначального `stanza-create`, после изменения PostgreSQL/pgBackRest config и ежедневно
   выполнять `pgbackrest --stanza=platform check`. `check` проверяет repository, конфигурацию
   archiving, создаёт restore point и переключает WAL, чтобы подтвердить доставку segment
   ([pgBackRest: check configuration](https://pgbackrest.org/user-guide.html#quickstart/check-configuration)).
2. После каждой backup job сохранять успешный exit code и проверять `pgbackrest --stanza=platform
   --output=json info`: status, timestamp stop, backup dependencies и WAL min/max. pgBackRest
   гарантирует, что требуемый для согласованности backup WAL range находится в archive до успешного
   завершения backup
   ([pgBackRest: backup information](https://pgbackrest.org/user-guide.html#quickstart/backup-info)).
3. Еженедельно выполнять `pgbackrest --stanza=platform --output=text verify`, либо
   `--set=<latest-label>` для ограниченной проверки. `verify` определяет, валидны ли backup'ы и WAL
   archives repository
   ([pgBackRest: verify command](https://pgbackrest.org/command.html#command-verify)).
4. Ежемесячно выполнять настоящий restore на чистую временную машину. Только он одновременно
   проверяет S3 access, encryption key, package/bootstrap instructions, throughput, WAL chain и
   прикладные assertions.

Если cluster создан с PostgreSQL data page checksums, pgBackRest автоматически проверяет их во
время backup и записывает invalid pages в manifest, но warning сам по себе не прерывает backup.
Поэтому любой checksum warning должен делать операционную job неуспешной
([pgBackRest: `checksum-page`](https://pgbackrest.org/command.html#command-backup/category-command/option-checksum-page)).

## Восстановление пустого VPS

Runbook обязан быть исполним без файлов с потерянного host.

1. Зафиксировать `t0` — время объявления incident — и держать новый PostgreSQL недоступным
   приложению до завершения validation.
2. Создать VPS с достаточным диском и пропускной способностью. Установить тот же PostgreSQL major,
   совместимый актуальный minor, тот же pgBackRest release и расширения. Physical data directory
   между PostgreSQL major versions несовместим; major upgrade требует dump/reload или `pg_upgrade`
   ([PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)).
3. Восстановить отдельно хранимые declarative config, S3 credentials и
   `repo1-cipher-pass`; создать пустой `PGDATA` с правильными owner/mode и тот же `pg1-path`.
4. До изменения repository выполнить read-only `pgbackrest --stanza=platform --repo=1 info` и
   выбрать последний известный валидный backup set. Не запускать `stanza-create`: stanza уже
   существует в off-host repository.
5. Остановить PostgreSQL и выполнить latest recovery:

   ```bash
   pgbackrest --stanza=platform --repo=1 --process-max=<measured> restore
   ```

   pgBackRest требует остановленный cluster и пустой data directory; обычный restore выбирает
   latest backup, а PostgreSQL затем проигрывает WAL до конца доступного archive
   ([pgBackRest: restore a backup](https://pgbackrest.org/user-guide.html#quickstart/perform-restore),
   [pgBackRest: PITR](https://pgbackrest.org/user-guide.html#pitr)). Для известной логической порчи
   использовать точку до события:

   ```bash
   pgbackrest --stanza=platform --repo=1 \
     --type=time --target='<PostgreSQL timestamp with UTC offset>' \
     --target-action=promote restore
   ```

   pgBackRest сам записывает `restore_command` и recovery target в `postgresql.auto.conf`; target
   должен быть позже конца выбранного backup. Для повторной попытки сначала снова очистить target
   `PGDATA` или использовать документированный `--delta` только после осознанной проверки.
6. Запустить PostgreSQL, дождаться окончания recovery, проверить server log и зафиксировать время
   последней применённой transaction. PostgreSQL рекомендует проверить содержимое cluster до
   возврата обычного доступа
   ([PostgreSQL: recovering from continuous archive](https://www.postgresql.org/docs/current/continuous-archiving.html#BACKUP-PITR-RECOVERY)).
7. Выполнить SQL assertions: ожидаемые databases/extensions/migration version, referential sanity,
   последняя recovery marker; затем application smoke check. Зафиксировать `t_ready` и только после
   этого разрешить production traffic.

PostgreSQL WAL не восстанавливает внешние `postgresql.conf`, `pg_hba.conf` и `pg_ident.conf`, если
они лежат вне покрытого backup'ом data directory. Их воспроизводимость должна проверяться тем же
full-VPS drill
([PostgreSQL: archive caveat for configuration](https://www.postgresql.org/docs/current/continuous-archiving.html#BACKUP-ARCHIVING-WAL)).

## Recovery drill и измерение целей

Ежемесячный database drill:

1. Не менее суток перед drill раз в пять минут записывать UTC marker с уникальным drill ID и
   временем commit в служебную таблицу. Не выполнять `pg_switch_wal()` после marker: это намеренно
   измеряет обычный путь и действие `archive_timeout`.
2. В случайный момент зафиксировать `t0`, прекратить marker writes и запретить drill host любой
   доступ к исходному VPS; восстановить только из S3 на чистый host по runbook выше.
3. Найти максимальный восстановленный marker timestamp `t_marker`; измерить
   `observed_rpo = t0 - t_marker`. Pass: `observed_rpo <= 60 min`.
4. После database assertions и application smoke зафиксировать `t_ready`; измерить
   `observed_rto = t_ready - t0`. Pass: `observed_rto <= 4 h`.
5. Сохранить backup label, WAL max, размеры, download/replay durations, обе метрики и отклонения
   runbook. Drill считается failed при ручном поиске отсутствующего секрета/шага, даже если итоговое
   время уложилось в SLO.

Раз в квартал нужен full-VPS drill с тем же bootstrap, storage credentials и network isolation,
поскольку database-only drill не доказывает четырёхчасовое восстановление пустого VPS. Для
оперативной оценки риска между drill'ами PostgreSQL предоставляет `pg_stat_archiver` с
`last_archived_time`, `last_failed_time` и counters, но timestamp последней архивации не заменяет
проверку фактически восстановленных данных
([PostgreSQL: `pg_stat_archiver`](https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-ARCHIVER-VIEW)).

## Граница release rollback и migration recovery

Перед изменяющей schema migration release job может создать именованную точку и принудительно
завершить segment:

```sql
SELECT pg_create_restore_point('before_release_<id>');
SELECT pg_switch_wal();
```

После этого release продолжает migration только когда pgBackRest `check` или эквивалентная
проверка подтверждает segment в off-host archive. PostgreSQL документирует `pg_switch_wal()` как
способ без задержки отправить только что завершённую transaction в archive
([PostgreSQL: WAL control functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-BACKUP)).

Эта точка — аварийная страховка, не штатный rollback:

- continuous archive восстанавливает весь cluster, а не отдельную database или migration; для PITR
  нужна непрерывная WAL chain
  ([PostgreSQL: scope and requirements of PITR](https://www.postgresql.org/docs/current/continuous-archiving.html#BACKUP-ARCHIVING-WAL));
- recovery на `before_release_<id>` удалит все commits всего cluster после этой точки, включая
  корректные пользовательские записи;
- rollback container image после уже применённой migration безопасен только при schema,
  совместимой со старым приложением; destructive contract должен происходить отдельным поздним
  release после периода совместимости;
- transaction вокруг migration откатывает вошедшие в неё statements, но не все production-safe
  DDL можно выполнять в одном transaction block: например, `CREATE INDEX CONCURRENTLY` явно этого
  не допускает
  ([PostgreSQL: concurrent index build](https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)).

Следствие для единой схемы выпуска: не объявлять «restore pre-release backup» обычным rollback.
Штатный путь — backward-compatible migration, rollback приложения и затем forward repair/down
migration, заранее проверенная на копии production. PITR требует owner decision о допустимой потере
всех post-target writes и отдельного incident runbook.

## Критерии готовности production recovery

- S3 repository физически вне production VPS; bucket/prefix и restore credentials проверены с
  чистого host.
- `check`, backup schedule, retention и `verify` выполнялись без ошибок полный retention cycle.
- Encryption key доступен recovery operator без исходного VPS; TLS verification включена.
- Последние database и full-VPS drills имеют `observed_rpo <= 60 min` и
  `observed_rto <= 4 h`.
- Drill восстановил latest state и отдельный PITR target; SQL assertions и application smoke
  перечислены в runbook, а не импровизируются во время incident.
- Release process отличает image rollback, migration rollback и destructive whole-cluster PITR.

## Первичные источники

- [PostgreSQL: Continuous Archiving and Point-in-Time Recovery](https://www.postgresql.org/docs/current/continuous-archiving.html)
- [PostgreSQL: WAL archiving configuration](https://www.postgresql.org/docs/current/runtime-config-wal.html#RUNTIME-CONFIG-WAL-ARCHIVING)
- [PostgreSQL: WAL control functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-BACKUP)
- [PostgreSQL: `pg_stat_archiver`](https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-ARCHIVER-VIEW)
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
- [PostgreSQL: `CREATE INDEX`](https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)
- [pgBackRest User Guide](https://pgbackrest.org/user-guide.html)
- [pgBackRest Configuration Reference](https://pgbackrest.org/configuration.html)
- [pgBackRest Command Reference](https://pgbackrest.org/command.html)

## Полный empty-VPS runbook

Database procedure выше встраивается в один host-level incident flow. Runbook хранится в Platform
repository и не ссылается на Workspace checkout, соседние repositories или machine-local path.

1. **0:00-0:15 — declare.** Owner фиксирует `t0`, incident/recovery target, останавливает
   production writes доступным kill switch или provider control plane, сохраняет последний
   off-host probe и marker. Выбирается latest recovery либо PITR до известной corruption point.
2. **0:15-1:00 — provision.** Создать чистый VPS нужного disk/CPU/RAM, применить firewall и
   bootstrap pinned Docker/Compose, Caddy, SOPS/age, PostgreSQL major и pgBackRest. Восстановить
   offline age identity; получить approved release manifest и encrypted config.
3. **1:00-2:30 — restore.** Расшифровать secrets в tmpfs, проверить pgBackRest repository, вернуть
   PostgreSQL cluster и replay WAL. Параллельно pull images по digest и восстановить Caddy/collector
   config. Не направлять public traffic.
4. **2:30-3:15 — validate.** SQL assertions, migration/release version, Logto issuer/sign-in,
   API/content access, S3 CRUD/version restore, queue -> worker, Kinescope authorization и MCP
   smoke. Несовпадение schema/manifest блокирует запуск.
5. **3:15-4:00 — cut over.** Запустить application slot, подтвердить readiness, направить DNS или
   stable address на новый VPS, дождаться valid TLS и зелёного off-host journey. Открыть writes,
   зафиксировать `t_ready`, recovered marker и фактические RPO/RTO.

Временные доли — budget, а не обещание каждой фазы. Drill должен измерить download/WAL replay и
оставить не менее 45 минут на validation/cutover; если restore стабильно съедает этот запас,
увеличивается bandwidth/backup cadence либо уменьшается data set до запуска.

После incident старый cluster не подключается обратно автоматически. Он остаётся read-only и
изолированным до решения о reconciliation/deletion; два writable production timelines запрещены.
Использованные bootstrap credentials и deploy keys ротируются, а incident закрывается только после
нового зелёного backup/check.

## Проверки выпуска, отката и восстановления

| Когда | Проверка | Pass | Failure action |
|---|---|---|---|
| Каждый PR | Полный CI matrix, Compose boot, fresh/upgrade migrations, `N-1 app + N schema` | Все gates зелёные | Не merge |
| Каждый merge в `main` | Build once, SBOM/provenance, immutable manifest | Все digest'ы и checksums сохранены off-host | Не deploy |
| Staging deploy | Migration, readiness, smoke и synthetic journey | Manifest отмечен green | Candidate stop/forward repair |
| Перед production | Owner принял exact manifest; backup/WAL/alerts/capacity green | Preflight report приложен к deployment | Не начинать migration |
| Production switch | Direct smoke inactive slot, Caddy validation | Все critical journeys green | Не switch либо switch назад |
| Observation window | 30 минут error/latency/auth/queue/provider signals | Нет critical alerts | Owner-controlled rollback/kill switch |
| Ежедневно | `pgbackrest check`, backup/WAL freshness, alert heartbeat | Repository/WAL/current release green | Critical incident до восстановления coverage |
| Еженедельно | `pgbackrest verify`, asset-version sample restore | Integrity green | Freeze production changes, repair backup path |
| Ежемесячно | Чистый database restore + application smoke | Measured RPO/RTO и assertions pass | Corrective issue, launch/release blocked при потере coverage |
| Ежеквартально и после infra/secrets change | Полный empty-VPS drill | `RPO <= 1h`, `RTO <= 4h`, нет скрытого ручного знания | Recovery не готова |

## Критерии готовности полного пользовательского запуска

- Staging физически отделён от production, имеет stable exact domains/callbacks, отдельные secrets,
  synthetic fixtures и provider test boundaries.
- PR/build/deploy workflows создают один manifest, продвигают digest без rebuild и сохраняют
  доказательства migration/smoke/owner acceptance.
- Production capacity выдерживает два application slot'а либо owner явно принимает измеренное
  recreate downtime; Caddy reload и previous-manifest rollback отрепетированы.
- Все migrations проходят fresh/upgrade/rollback-compatibility tests; destructive contract не
  находится в том же release, что переключает application reads/writes.
- SOPS manifests имеют host и offline recipients; break-glass packet восстановлен в drill; ни один
  production runtime secret не нужен GitHub-hosted runner.
- Off-host logs/metrics/black-box alerts видят release ID, host, PostgreSQL/WAL, queue, callbacks и
  backup freshness и сами имеют heartbeat.
- pgBackRest прошёл полный retention cycle; monthly restore и quarterly empty-VPS drill доказали
  targets по восстановленным markers, а не по timestamp успешной job.
- External S3 version restore, Logto database/connectors/`SECRET_VAULT_KEK`, Kinescope access и
  callback inventory включены в recovery smoke.
- Owner знает один production GO path, один штатный app rollback path и отдельный destructive PITR
  incident path; runbooks исполнимы из автономного Platform repository.

## Owner decisions перед реализацией

1. Одобрить постоянный staging на отдельном VPS и его budget вместо shared production host.
2. Выбрать VPS/S3/telemetry providers, region, disk class, retention price ceiling и alert channel;
   подтвердить у S3-compatible provider versioning, restore и pgBackRest compatibility.
3. После capacity spike выбрать blue/green slots или явно принять короткое recreate downtime.
4. Проверить GitHub plan: protected private Environment с required reviewer либо fallback
   `workflow_dispatch` с owner-only GO.
5. Утвердить production/staging domains и отдельные Logto/Kinescope/S3/callback registrations до
   первого public release; Logto и Kinescope остаются subject to hard gates своих исследований.

После этих решений Platform repository должен превратить документ в versioned `infra/`, deploy
scripts, smoke tests и runbooks. Покупка ресурсов и настоящий deployment остаются отдельными
owner-approved действиями.
