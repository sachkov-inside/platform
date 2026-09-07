# Platform communications integration

Platform #307 owns the Account-authorized HTTP/MCP consumer and Telegram author authorization.
The product authority is the accepted
[Workspace communications contract](https://github.com/sachkov-inside/workspace/blob/1553211220c44882dbacce7519dd50e35493090e/docs/specifications/telegram-communications-v1.md).
Telegram owns the physical schema and mutable communications state. Its pinned revision is recorded
in [the vendored snapshot](../../apps/backend/src/modules/communications/contracts/inside-communications-v1/snapshot.json).
Platform stores only the outgoing tracking-event ledger in `communications.tracking_hits`; it has no second mutable definition store or broadcast scheduler.

## Identity and permission

An author needs a confirmed Telegram link and the current Account permission `communications:manage`.
The owner confirmed the link prerequisite during #307 implementation on 2026-09-06. A recipient does
not need a Platform Account. `materials:manage`, Membership, a Telegram username, and knowledge of a
template ID confer no communications authority.

The current linking protocol passes a private `principalRef` as its external `accountRef`; it is not
`Account.id`. The facade resolves the authenticated Account to exactly one confirmed link and uses
that same stable reference that Telegram intake uses to own templates. An absent or ambiguous link
returns `link_required`; unavailable persistence fails closed. This preserves the existing exact
Logto `(issuer, subject)` identity, account establishment and independent Membership checks. The
merged sign-in delivery in [#299](https://github.com/sachkov-inside/platform/issues/299) writes the
same confirmed-link seam. Integration tests cover its Telegram-only Account and repeated sign-in
without implicit communications grants. Real Logto/provider end-to-end sign-in remains separately
verified by #299; #307 does not claim a new credentialed sign-in run.

`POST /integrations/telegram/v1/communications/authorize` implements the vendored
`authorizationRequest`/`authorizationResponse`. A separate service bearer credential authenticates
Telegram. Account subjects resolve the external reference to the current link and Account permission.
Telegram subjects additionally match the configured bot identity and exact stored provider identity.
Denied responses echo only contract version, request ID and `status: denied`; allowed responses echo
the checked external Account reference. No username lookup, raw Telegram ID lookup, role copied from
a JWT, or cached authorization is involved. A database failure returns HTTP 503, never an allow.

## HTTP and delegated MCP

`POST /communications` accepts the provider management envelope with `actor` removed. It validates
unknown input and derives the actor on the server. Every operation, including a repeated operation
ID, checks current permission and link state before calling Telegram. Responses use `{ ok: true,
value: <provider response> }`; failures are HTTP Problem Details. MCP uses the same application
operation and error codes in `{ ok: false, error: { code } }` with `isError: true`.

The delegated OAuth MCP endpoint registers `communications_<operation>` tools, replacing the dot
with an underscore, for these provider commands:

- `templates.read`, `templates.save`, `templates.testSend`;
- `intro.read`, `intro.save`;
- `funnels.list`, `funnels.read`, `funnels.save`, `funnels.preview`, `funnels.publish`,
  `funnels.lifecycle`, `funnels.rollback`;
- `broadcasts.list`, `broadcasts.read`, `broadcasts.save`, `broadcasts.launch`, `broadcasts.lifecycle`;
- `deliveries.read`, `delivery.resolve`, `statistics.read`, `entries.read`.

Source definitions are read and saved with the funnel; the provider contract has no separate source
mutation. MCP input omits `contractVersion` and `operation`, which are fixed by each tool, and retains
caller-supplied `operationId`, `expectedRevision`, and `payload`. Preserve all three on a retry of the
same request. There is no extra UI approval gate for delegated publish or launch. Publication and
sending remain explicit operations; a read or preview never invokes test-send or launch.

`templates.testSend` has no caller-selected recipient: it addresses only the confirmed Telegram
author through the provider contract. `delivery.resolve` selects one part, retains the expected
revision, and requires `duplicateRiskAccepted: true` for explicit retry. An uncertain provider call
is never automatically retried by Platform. `provider_unavailable`, `provider_invalid_response`,
revision/operation conflicts and the provider's `not_implemented` are visible failures. A success
must have the expected operation's response shape and matching object identifiers.

`POST /communications/templates/resolve` and `communications_templates_resolve` accept `reference`
and `operationId`. A reference is a UUID or an HTTPS URL with the exact path
`/communications/templates/<uuid>`, without credentials, query or fragment. The URL host is untrusted
and is never fetched; only the extracted object ID reaches the authorized `templates.read` operation.
A foreign template remains `not_found`.

Eligibility remains separate Platform #310 work. Public tracking belongs to #309 and cannot be called through delegated management tools. Provider commands still marked contract-only return `not_implemented`;
this facade does not deliver their scheduler or audience runtime. Funnel UI is #308; broadcast/analytics UI is #309; #310 owns combined
provider/consumer and end-to-end acceptance.

## Configuration and owner bootstrap

Communications are unconfigured by default. Configure all four variables together in the API and MCP
process environments. Partial configuration fails startup:

| Variable                               | Meaning                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_COMMUNICATIONS_ENDPOINT`     | Provider URL ending exactly in `/integrations/platform/v1/communications`; HTTPS, or HTTP on loopback for an isolated local test |
| `TELEGRAM_COMMUNICATIONS_SECRET`       | Existing provider `PLATFORM_INTEGRATION_SECRET`, kept only in private runtime configuration                                      |
| `TELEGRAM_AUTHOR_AUTHORIZATION_SECRET` | Dedicated callback bearer secret matching the provider's `PLATFORM_AUTHOR_AUTHORIZATION_SECRET`                                  |
| `TELEGRAM_COMMUNICATIONS_BOT_IDENTITY` | Exact configured provider bot identity; not the author's Telegram username                                                       |

Point the provider's `PLATFORM_AUTHOR_AUTHORIZATION_URL` at the Platform authorization endpoint above.
Connections reject redirects and time out after five seconds. Credentials are never placed in URLs,
client inputs, logs, fixtures, or shared repository state. The runtime source and container env-file
rules are in [runtime configuration](../runbooks/runtime-configuration.md).

Use the existing explicit release bootstrap with the owner's exact Logto identity and
`OWNER_PERMISSION=communications:manage`. The default remains `materials:manage`; selecting one
never grants the other. Grant creation and its audit event commit together and concurrent/repeated
bootstrap is idempotent. The audit includes the permission being granted. No migration, startup
hook or public route grants an author permission. Actual grants and production configuration remain
explicit owner operations; #307 does not configure a real author or send real messages.

## Verification

`pnpm --filter @inside/backend communications:generate` derives typed Zod codecs from the pinned
provider schema. `communications:check` verifies deterministic output and runs in backend guardrails.
The generator rejects schema vocabulary it cannot represent. The vendored positive/negative fixtures
run against both the generated codecs and the original JSON Schema. Public input rejection and
cross-module import negative fixtures protect the consumer seam without neighboring checkouts.

Real PostgreSQL tests cover independent grants, audit/idempotency, confirmed-link authorization,
revocation, denied ordinary/materials-only/unlinked Accounts, and signed-token HTTP/MCP parity.
A local HTTP contract stub checks the service credential and calls the real author authorization
endpoint. Vendored scenarios check consumer forwarding, repeated operation IDs, stale revisions,
foreign templates and permission revocation. Stub success for publish/launch proves consumer rights
and transport parity, not actual publication, audience selection or Telegram delivery.

## Broadcasts and analytics UI

`/authoring/communications/broadcasts` uses the same Account-authorized facade as MCP through named same-origin
BFF operations. Browser TanStack Query owns lists and statistics; writes have distinct literal routes.
A draft holds ordered text or imported template parts, buttons, union audience and a local-time date
with the displayed timezone. Saving a date does not launch: explicit launch schedules a future draft
or starts an immediate draft. The audience snapshot appears only after actual launch. Pause/resume
keeps it; terminal broadcasts cannot launch again. Uncertain writes disable further effects until
an explicit reload, preserving author intent instead of automatically repeating delivery.

The presentation uses temporary semantic forms under #309, with the final Storybook proof and visual
integration tracked in #317. Existing Authoring shell and accepted primitives remain the foundation.
No real audience messages or provider media downloads are part of preview. Imported formatting/media
references survive unchanged; explicit textarea edits clear the displayed formatting warning's entities.
Statistics, contact entry history, funnel/source names, broadcasts and deliveries paginate through the
provider contract. Contacts are opaque IDs, never raw Telegram identities. Each source first/latest
observation is separate from its entry history. Counts of parts sent, hits, unique tokens with hits
and named automation are separate; a forwarded link proves neither the visitor Account nor reading,
Membership or purchase.

## Public tracking and durable event delivery

Set `TELEGRAM_TRACKING_ORIGIN` to the exact HTTPS public Platform origin. It is optional and disables
tracking when absent. Configure Telegram's `PLATFORM_TRACKING_REDIRECT_URL` as that origin plus
`/communications/visit`; its permitted targets must match Platform `/materials/<slug>` and
`/series/<slug>` routes. The route accepts only an opaque `token`; caller-supplied destination URLs
are ignored. It resolves through the authenticated provider with `serviceRef: platform-tracking`,
then independently checks origin, canonical content path, HTTPS, no credentials/query/fragment.
Invalid or unresolved tokens return a safe 404/503. GET returns private no-store, no-referrer 302;
HEAD does not create hits. Destination routes still run their normal ContentAccess checks.

Only named TelegramBot, facebookexternalhit, Twitterbot, Slackbot-LinkExpanding, Discordbot,
Googlebot and bingbot user agents are marked `known_automation`. Other traffic is `unknown`, never
asserted to be human. User agents, IPs, Account identities and credentials are not stored in events.

Each resolved GET creates its own durable event ID. The API's lifecycle-owned outbox pump atomically
claims due rows and sends bounded parallel batches. Both event ID and operation ID stay identical
across retries and process restarts; provider ingestion deduplicates even an ambiguous commit/ACK.
Expired claims are reclaimable; acknowledgements update only their own current claim. Failed events
remain pending and retry after 30 seconds. Statistics HTTP/MCP responses carry `trackingBacklog`:
current pending count and live age of the oldest pending event, or explicit `unavailable`. The provider's
historical received-event delay is displayed separately and never substitutes for live backlog age.

Navigation waits at most 750 ms for local persistence confirmation after safe resolution. A failed or
unconfirmed insert emits a token-free operational error and allows navigation; only actually persisted
events can recover automatically. A local database outage may therefore lose hits. The dashboard
reports an unavailable backlog during that outage rather than a fabricated zero. Provider outages
retain already persisted events for retry. The BFF's named 12-second communications budget covers the
provider's five-second bound and local persistence; normal backend requests retain their existing budget.

`pnpm smoke:communications` owns disposable PostgreSQL and ephemeral host ports, synthetic delegated
identity and a Telegram contract stub. It proves desktop/mobile Browser → BFF → Nest, management
identity, preview/save/launch/lifecycle, analytics/history, private redirect and anonymous denial, and
captures screenshots in `ci-artifacts/communications`. It does not touch the shared Compose stack.
Real provider scheduling, Telegram sends and the combined live content route remain #310 acceptance.

## Funnel management UI

`/authoring/communications` uses the production AuthoringShell and a feature-local presentation
interface shared with Storybook. Browser-owned named mutations call capability BFF routes under
`/api/communications`; the shared authenticated boundary enforces Origin, session, body limit and
private no-store. The server adapters validate unknown responses and use the generated Nest client.
Draft saves, preview, publish, intro save, lifecycle, template resolution and delivery retry/skip
are separate operations. Repeated identical attempts retain their operation ID within the open
editor; permission and expected revision remain backend/provider decisions. Reloading a conflicted
editor explicitly replaces the local edits. Source codes are stable after the first save.

Common intro Save updates the block for future recipients immediately, explicitly labelled in UI;
funnel Save never publishes. Media templates keep their snapshot and formatting. Editing formatted
text requires an explicit remove-formatting action, avoiding silent entity loss. Preview never
sends a Telegram message. Actual bot entry and credentialed messages require separate owner approval.
Rollback remains an API capability and is outside this editor's lifecycle controls. The existing
rollback path does not run this new validation: the provider contract cannot yet expose a historical
snapshot for Platform validation. Closing that integration gap is tracked by #310; validation here
covers fresh preview/publish only.

Set `TELEGRAM_COMMUNICATIONS_PUBLIC_ORIGIN` to the canonical public Platform origin, matching
`WEB_BASE_URL`. Without it publication/preview fail closed. The Materials-owned `PublicContentTargets`
facet checks linked Materials and Series for publication, free access and complete composition;
Communications validates Platform URLs in plain text, buttons and Telegram URL/text_link entities (including bare-domain entities) before a fresh
publish and adds URL-specific failures to preview. An already committed publish replay stays owned
by the provider receipt. Content access is still checked by the public Reader; this point-in-time
validation does not grant access or promise availability after a later unpublish.

The Platform success envelope adds `botStartUrl` for entry links and optional `targetErrors` for
content diagnostics. These are Platform presentation facts, not a second Telegram schema. The
provider-owned `funnels.preview` is supplied by [Telegram #34](https://github.com/sachkov-inside/inside-telegram/issues/34).
The functional UI's temporary semantic implementation is tracked through visual integration
[#316](https://github.com/sachkov-inside/platform/issues/316), under Specification #304.

## Посты из Telegram и рассылки (#317, уточнение #125)

Основной путь подготовки сообщения — `/admin` в Telegram. Страница разовых рассылок загружает
`templates.list`, позволяет настроить кнопки сохранённого поста через `templates.save`, запросить
`templates.testSend` только автору и выбрать сохранённую версию в рассылку. Текст в редакторе рассылки
доступен для чтения: он больше не сбрасывает native entities при вводе. Для замены текста/медиа автор
заменяет сообщение в боте и явно выбирает новую часть в веб-редакторе.

Кнопки сохранённого поста и кнопки выбранной копии в черновике — разные снимки. «Сохранить пост»
не меняет уже выбранные части или запланированные рассылки; «Заменить часть» применяет выбранный
снимок явно. Необязательный `row` сохраняется в BFF/schema/generated client и MCP без потери.
Provider проверяет layout до сохранения. Образец использует только сохранённую версию поста;
web preview не вызывает Telegram transport. Повтор запроса образца после неопределённого ответа
сохраняет тот же operationId и revision, в том числе после перезагрузки страницы.
Неподтверждённая операция хранится в браузере до получения ответа; при недоступном хранилище
новая отправка не начинается. Очистка данных браузера удаляет эту защиту.

Delegated MCP получает `communications_templates_list` и те же save/read/testSend operations;
текущий authenticated Account и communications:manage остаются единственным авторским основанием.
Публикация и запуск по-прежнему отдельны от сохранения. Provider runtime поставляется в
[Telegram #39](https://github.com/sachkov-inside/inside-telegram/pull/39), shared decision —
[Workspace #125](https://github.com/sachkov-inside/workspace/issues/125). Schema snapshot pinned
на commit из `contracts/inside-communications-v1/snapshot.json`; production enablement не меняется.

## Создание воронок из сохранённых постов (#316)

Веб-редактор использует общую библиотеку постов рассылок: `templates.list/read/save/testSend`.
Выбор добавляет копию содержимого в первый ответ, общий вводный блок или отложенный шаг.
Оформление и медиа готовятся в Telegram; в библиотеке можно поправить кнопки и отправить образец
только подтверждённому автору. Карточки воронки показывают выбранное содержимое и ряды кнопок.
Явная замена сохраняет `partId`, добавление создаёт новый. Правка исходного поста не меняет
черновик или публикацию. Задержки задаются в секундах, минутах, часах или днях.

Telegram [#40](https://github.com/sachkov-inside/inside-telegram/pull/40) использует сервисный
`POST /integrations/telegram/v1/communications/validate-content` перед публикацией из бота.
Контракт `contentValidationRequest/Response` передаёт выбранные сообщения вместе с подтверждённым
автором. Endpoint проверяет bearer credential, актуальную связь и `communications:manage`, затем
доступность Material/Series через `PublicContentTargets`. Он не обращается к Telegram; поэтому
проверка безопасна при удерживаемых ботом блокировках определения. Ошибка конфигурации или базы
возвращает 503, недоступные цели — структурированные причины. Для установки требуются
`TELEGRAM_COMMUNICATIONS_PUBLIC_ORIGIN` в Platform и `PLATFORM_AUTHOR_CONTENT_VALIDATION_URL` в
Telegram. Используется существующий secret авторизации, новый credential не создаётся.
