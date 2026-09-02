# Sachkov Inside Platform v1 — UX brief

Статус: owner-approved UX input от 2026-08-21 для
[Platform issue #20](https://github.com/sachkov-inside/platform/issues/20). Документ фиксирует
подтверждённую UX-границу, трассировку требований, state/action matrices и low-fidelity
wireframes. Fixture corpus, IA и coarse copy приняты owner в working session; документ не выбирает
visual language и сохраняет implementation decisions, перечисленные в конце. Provisional
owner-taste constraints записаны отдельно в
[Platform v1 visual brief](platform-v1-visual-brief.md), а integrated production delivery
принадлежит [Platform Specification #19](https://github.com/sachkov-inside/platform/issues/19).
Material lifecycle и access presentation уточнены owner decision #132 от 2026-08-27.

Snapshot источников: 2026-08-27. Repository-owned product/application contract и glossary
ссылаются на current relative files и синхронизируются этим change; cross-repository provenance
привязан к merge commit
[`ed5b555a`](https://github.com/sachkov-inside/workspace/commit/ed5b555a0171a53ab17a5ed388d80575c8025f03)
Workspace [PR #61](https://github.com/sachkov-inside/workspace/pull/61).

## 1. Purpose и граница

Platform v1 должна стать каноническим домом полноценных материалов Inside. Участник Membership
должен удобно находить и читать доступный контент, а публичный посетитель — видеть реальный состав
и ценность Membership до покупки. Telegram остаётся местом community, коротких анонсов и внешнего
Membership lifecycle. ([Platform MVP brief][platform-brief-outcome],
[Workspace v1 specification][workspace-v1-result])

Этот brief отвечает только на структурные UX-вопросы:

- какие actors должны пройти какие journeys;
- какие product surfaces нужны v1 и как они связаны;
- где отображаются подтверждённые domain и access states;
- какое UI-следствие имеет каждое требование v1, либо почему UI для него не нужен;
- какие решения нельзя принимать без owner input.

В этот документ намеренно не входят palette, typeface, icon style, visual density, component
library, motion language и иные styling decisions. Functional states и responsive behavior этого
brief являются representative inputs UI laboratory и owning production surfaces. Exact typed
presentation boundary, data integration и delivery order принадлежат
[application specification](../specifications/platform-v1.md).
([Workspace v1 scope][workspace-v1-scope])

Также не проектируются billing, subscription management, тарифы, trial, promo/gifts, comments или
community внутри Platform, notification center/email notifications, AI search, multi-author review,
UGC, achievements/gamification, Telegram import/migration и bot messaging/admin workflows.
([Workspace v1 scope][workspace-v1-scope])

### Product context, который ограничивает UX

- Основная аудитория — разработчик, который уже умеет программировать и выбирает релевантные
  направления самостоятельно; Platform не должна притворяться обязательным линейным курсом.
  ([Inside audience][product-audience])
- Ценность строится на реальной инженерной практике, контексте решений и связанных коде, схемах,
  документах, дизайне и других artifacts, а не только на готовом ответе.
  ([Inside product value][product-value])
- Build-series — флагманская линия, но не весь Membership. IA должна сохранять несколько Topic и
  Series trajectories и не сводить Home/Library к одному course progress.
  ([Inside build-series][product-build-series])

### Порядок authority

1. Platform repository владеет product/application contract и glossary, а Workspace — shared
   product и cross-repository решения. Более позднее явное owner decision имеет приоритет, после
   чего owning document должен быть синхронизирован. ([Platform brief authority][platform-brief-authority],
   [Platform specification authority][platform-spec-authority],
   [Workspace authority rule][workspace-v1-authority])
2. Repository-local MVP brief и application specification уже синхронизировали более поздние
   owner decisions: Materials создаются вручную без import/migration, а individual discussion
   relation не входит в обязательный v1 scope. UX не проектирует соответствующие surfaces;
   Workspace links ниже остаются provenance, а не runtime/agent dependency.
   ([Platform application boundaries][platform-spec-boundaries],
   [publishing audit decisions][audit-decisions])
3. Конкретная taxonomy и sanitized content fixture не выводятся из общих продуктовых формулировок:
   они должны опираться на реальный контент и отдельное owner approval. Для этого brief owner
   делегировал выбор representative sanitized corpus и утвердил bounded F1–F3 ниже; эти values не
   становятся seed ontology.
   ([Publishing audit boundary][audit-boundary])

### Owner decisions этой UX-сессии

- Public landing и Platform application — разные surfaces: landing объясняет предложение и ведёт
  в application/Мастерскую; application владеет content discovery/reading/account. `sachkov.dev` и
  `app.sachkov.dev` — рабочие примеры, не production domain commitment этой UX-задачи.
- Free content доступен без account. Email-code sign-in одновременно создаёт или открывает
  account; отдельной registration form нет.
- После первого sign-in Platform сразу предлагает связать Telegram, но шаг можно пропустить.
  Позже Linking доступен только в Account; locked Material не создаёт второй recovery flow.
- Closed Material остаётся addressable и индексируемой public page с teaser. Один CTA
  `Получить доступ` для любого locked state ведёт на общую Platform setting с Tribute URL; ссылка
  не является полем Material, billing integration или источником Membership state.
- Top-level navigation: `Главная`, `Библиотека`, `Карта`. Темы и Серии открываются контекстно из
  Home, cards и Materials.
- Signed-in Home: conditional `Продолжить`, затем лента новых материалов, Темы, активные Серии и
  entry в Карту. Короткая history живёт на Home, полная — в Account.
- Library filters: `Тема`, `Формат`, `Серия`; multiple values работают как OR внутри facet и AND
  между facets. Tags остаются visible/searchable links без отдельной filter panel.
- `Topic` отображается как `Тема`. `ReadingState` меняется только явным user action, без scroll,
  time или video-completion heuristics.
- Authoring полностью доступен на narrow mobile, а не ограничен preview/publish режимом.
- Owner делегировал selection материалов; F1–F3 ниже утверждены как sanitized representative corpus.

## 2. Подтверждённые actors

Названия ниже описывают UX-персоны, а не новые authorization roles. Доступ всегда определяется
центральным `ContentAccess`; UI только отображает coarse outcome и не воспроизводит Membership rules.
([ContentAccess decision][access-decision])

| Actor | Подтверждённое состояние | Основная v1 job | Важная граница |
|---|---|---|---|
| Public visitor | Anonymous Subject, Account не требуется | Понять состав Membership, найти материал, прочитать free Material, увидеть teaser закрытого Material | Видит public projection, но closed body/assets/video не загружаются |
| Authenticated non-member | Account без активного entitlement: Telegram ещё не связан, Membership не найден либо evidence недоступно/устарело | Связать Telegram, видеть текущий Membership state, продолжать пользоваться public/free content | Сам факт login или Telegram link не даёт Membership |
| Active member | Account с current bounded `MembershipEntitlement` | Найти, прочитать, скачать и посмотреть доступный closed content; управлять read status/history | Каждая новая protected operation повторно проверяет доступ |
| Expired member | Account и Telegram link/history сохранены, но entitlement не активен | Понять причину закрытого состояния, дождаться автоматического обновления после rejoin, продолжать читать free content | Потеря Membership не удаляет account, link, history или read states |
| Author | Account с `materials:manage`; в v1 фактически Кирилл | Создать и сохранить Material целиком, управлять metadata/resources/access/lifecycle, validate и preview | Permission даёт полный authoring authority, но не является `MembershipEntitlement` |
| Owner agent | User-delegated OAuth от owner Account | Выполнить тот же full-state Save и получить те же validation/conflict outcomes | Использует тот же `materials:manage`, включая publish/unpublish; отдельного owner GO нет |

Access distinctions подтверждены общей matrix для anonymous, authenticated, active, expired,
author. ([ContentAccess matrix][access-matrix]) Email login, явное Telegram linking и
сохранение account/history после окончания Membership заданы продуктовым brief.
([Platform actors][platform-brief-actors])

## 3. Канонический UX vocabulary

### Identity и access

| Термин | Подтверждённое значение | Не называть/не моделировать как |
|---|---|---|
| `Account` | Stable local identity одного человека, authenticated через Logto | provider subject, email, session или machine identity |
| `Subject` | Anonymous visitor или authenticated Account, для которого принимается access decision | Telegram user или browser session |
| Membership signal | Наличие связанной Telegram identity в одном canonical closed Inside chat | Tribute subscription или payment status |
| `MembershipEvidence` | Нормализованное наблюдение Membership signal с конечным сроком действия | raw Telegram status или permanent member flag |
| `MembershipEntitlement` | Ограниченный по времени Platform grant для closed content | IdP/Telegram role или subscription |
| `Resource` | Material body, Asset или Video с publication state и access class | URL, S3 key или Kinescope object |
| `ContentAccess` | Platform capability, принимающая allow/deny decision для Subject × Action × Resource | route-local paywall check или Membership middleware |
| Access decision | Outcome для одной операции `read`, `preview`, `download` или `play`, с reason и validity | долгоживущий boolean доступа |

Эти определения принадлежат repository-local glossary и owner-confirmed ContentAccess design.
([Platform glossary][platform-context], [ContentAccess vocabulary][access-vocabulary])

Для известного published membership-материала UI показывает одно coarse state `locked` и один CTA
`Получить доступ`. Internal reason codes, provider details, identity mapping и resource mismatch
пользователю не раскрываются. ([Access copy boundary][access-copy])

### Content и navigation

| Термин | Подтверждённое правило v1 | UX-следствие |
|---|---|---|
| `Material` | Stable mutable library/search/read identity с current body, metadata, access, publication state и `contentVersion` | Save атомарно заменяет текущее состояние; отдельных revisions и restore/history нет |
| `Topic` / «Тема» | Ровно одна на Material; managed, одноуровневый dictionary; metadata `name/slug/summary`, slug immutable, archive сохраняет связи | Topic page — generated view с полным derived-списком Series и paginated Materials; archived Topic исчезает из discovery, но canonical reader сохраняется |
| `Format` | Ровно один на Material; primary consumption mode, независимо от Topic и Asset kind | `video`, `guide` и будущие подтверждённые values не смешиваются с file/image/link |
| `Tag` | 0..N на Material; managed dictionary с rename/merge без duplicate synonyms | Tags видимы, searchable и ведут к похожему content; отдельной tag filter panel в v1 нет |
| `Series` | 0..N ordered memberships; ordinal принадлежит membership, Material может быть в нескольких Series; metadata `name/slug/summary`, slug immutable | Series page показывает полный ordered состав и derived Topics без копирования Material data; archive сохраняет reader и связи |
| `Asset` | Platform-owned image/downloadable file; Material ссылается по local ID | Body resource наследует access Material и имеет loading/processing/error/ready delivery states; cover публичен |
| `Video` | Local identity с Kinescope mapping; Material ссылается по local ID | Provider status не заменяет publication/access state |
| `ExternalLink` | Typed label + normalized URL, 0..N на Material | Link — часть Material, не отдельный Format и не entity by URL |
| `NavigationPage` | Editorial title/body + curated/query links | Roadmap — editorial/navigation page, а не Material, Topic или duplicated library table |
| `ReadingState` | Не более одного current state на Account/Material | Только `прочитано / не прочитано`; history — отдельный bounded personal projection |

Cardinalities и roles закреплены repository-local application specification.
([Platform logical model][platform-spec-logical-model]) «Создание Platform Inside» подтверждена как
ordered Series, Roadmap — как `NavigationPage`, Library/material index — как generated view; concrete
Topic/Format/Tag dictionaries остаются evolving fixtures, а не seed ontology.
([Workspace navigation roles][workspace-navigation-roles])

Canonical Material document — current ProseMirror JSON; `contentVersion` является optimistic
concurrency token, а не хранимой версией документа. Tiptap является authoring adapter.
Issue #20 требует, чтобы UX fixture проверял структурированный body, code, table, callout, image и
file, а отдельная Video section проверяла optional `primaryVideoId` вне body. Authoring schema
использует local IDs и исключает inline Video, raw HTML/MDX, iframe markup, provider tokens и
arbitrary layout blocks;
точные limits проверяются content-schema implementation на approved corpus. ([Workspace stack contract][workspace-stack],
[Platform issue #20](https://github.com/sachkov-inside/platform/issues/20),
[authoring schema][authoring-schema])

## 4. Information architecture без visual styling

### Surface model

| Surface | Audience | Job | Content authority / relation |
|---|---|---|---|
| Global navigation | Все browser actors | Открыть основную public destination и account context | Только База знаний; `/` redirect на `/library`, Карта доступна по прямому URL; Account/Author — actor utilities |
| Library / search | Все | Выбрать Topic/Series или найти published Material через full-text search и filters Тема/Формат/Серия | Отдельные real-data секции Topics, Playlists и Materials; multiple values: OR внутри facet, AND между facets; closed body отсутствует в public results |
| Topic | Все | Понять направление и перейти к связанным Series/Materials | Generated view по exactly-one Topic |
| Series | Все | Понять series и пройти ordered episodes; public visitor видит карточки и порядок даже closed Series | Ordered `SeriesMembership`; Material data не копируется |
| Roadmap | Все | Понять направления продукта и перейти к Topics/Series/Materials | Editorial `NavigationPage` с curated/query links |
| Material | Все с actor-dependent body state | Прочитать teaser/free/closed body, использовать image/file/video, related Materials и read status | Только current `published` state; public projection отделена от protected body |
| Sign-in handoff | Anonymous | Создать или открыть account одним email-code flow | После успеха и на каждом следующем входе при unlinked Telegram — центрированное skippable onboarding-окно один раз за authenticated browser session; separate sign-up form отсутствует |
| Account | Authenticated human | Видеть account, Telegram link и coarse Membership state; запускать link/local-state-update/recovery-supported actions | Account не управляет billing/subscription и не хранит Membership rule в UI |
| Telegram link result | Authenticated human | Отправить `/start` по short-lived bot link и увидеть linked / expired / conflict / unavailable outcome; Membership result остаётся в Account | Linking не является login и само по себе не даёт access; отдельного browser callback нет |
| Recent history / reading state | Authenticated human | Вернуться к недавно просмотренному, вручную mark read/unread | Последний/короткий список на Home, полная bounded history в Account; auto-mark отсутствует |
| Author material list | Author/admin | Найти draft/published/unpublished Materials, создать Material, открыть editor | Private, noindex; list не становится second content authority |
| Author Topic/Series | Author/admin | Создать, переименовать, описать, архивировать и восстановить Topic/Series; управлять полным составом Series | Slug immutable; composition сохраняется атомарно с optimistic conflict protection; archived references сохраняются, но не назначаются заново |
| Author editor | Author/admin | Атомарно сохранить document/metadata/access/publication state; видеть validation, upload и conflict states | Один full-state Save contract с MCP; published Save становится live сразу |
| Author preview | Author/admin | Проверить текущее сохранённое состояние тем же renderer до publish | Private/no-store/noindex; preview не меняет publication state |
| MCP | Owner agent, не browser actor | Выполнить те же Material, Topic, Series и composition operations | UI surface не требуется; browser admin и MCP используют одни application rules |

Public surfaces, account/admin boundaries и SEO rules закреплены в local specification.
([Platform application boundaries][platform-spec-boundaries], [Platform NFR][platform-spec-nfr]) Home/Library/Topic/Series
roles и personal layer подтверждены Platform brief.
([Platform navigation][platform-brief-navigation]) Roadmap и generated view semantics уточнены более
поздним Workspace contract. ([Workspace navigation roles][workspace-navigation-roles])

### Navigation relationships

- `/` перенаправляет на Library; Topic и Series открываются из real-data discovery sections.
- Library, Topic и Series являются разными generated views одной content model: они ведут к одному
  Material identity и не хранят собственные копии title/description/access state.
- Roadmap является editorial `NavigationPage`: её body объясняет направления, а links ведут в
  generated views или конкретные Materials.
- Material возвращает пользователя к своей Topic, всем Series memberships и related Materials;
  related выдача сочетает metadata score и explicit author pins без AI dependency.
- Account и author surfaces — отдельные private branches; они не должны попадать в public sitemap.

Эти relations следуют logical model и search/navigation flow.
([Workspace logical model][workspace-logical-model], [Workspace search flow][workspace-search-flow])
Top-level order и history placement подтверждены выше. Exact responsive disclosure и composition
проверяет UI laboratory и решает owning production surface ticket, не меняя состав IA и functional
states этого brief.

### Critical journeys

1. **Discover and read free.** Public visitor lands on Home or an indexed card, moves through
   Library/Topic/Series/Roadmap, opens F1 and reads body/Resources without creating an account.
2. **Understand a closed Material.** Public visitor opens F2/F3, receives the complete public
   projection and indexable teaser, but no closed bytes; one `Получить доступ` CTA opens the
   Platform-configured Tribute URL for every locked state.
3. **Link Telegram.** После каждого email-code sign-in при unlinked Telegram Platform один раз за
   authenticated browser session открывает центрированное skippable onboarding-окно поверх
   сохранённого destination. Компактное окно содержит только begin, Telegram `/start`, browser
   confirmation и финальный link result; Membership state и acquisition CTA в нём отсутствуют.
   После закрытия тот же flow и отдельный Membership state доступны из Account. Only current
   `ContentAccess` allow opens the body.
4. **Lose and restore access.** Expired member sees the same locked teaser and acquisition CTA while
   account/history/read state remain preserved and rejoins externally. Telegram event or background
   reconciliation produces fresh evidence; after Platform accepts it, the next local read restores
   access without relinking, recreating the account or request-triggered provider check.
5. **Find across language and metadata.** Any actor searches a RU/EN or typo probe, narrows results
   with only actually populated facets, opens one canonical Material, then follows its Topic,
   Series or related links without encountering duplicated copies.
6. **Author and preview.** Author creates a draft, sets Topic/Format/Tags/Series/access, builds the
   structured body, uploads Resources to `ready`, fixes validation, saves the complete current
   state and previews it through the production renderer contract.
7. **Recover from concurrent editing.** Full-state Save со stale `expectedContentVersion` получает
   `409`; editor сохраняет local input, показывает новую current version и даёт вручную reapply или
   reload без silent overwrite.
8. **Publish or update live.** Author или delegated agent с `materials:manage` одним validated Save
   меняет content, metadata, `free | membership` и publication state. Save published Material сразу
   обновляет reader, Library и search; отдельного prepare/owner GO или revision pointer нет.

В Account действие `Обновить состояние` означает только новый local Platform read. Оно не вызывает
Telegram, не запускает reconciliation и не ждёт provider; свежий status появляется после
независимого event/reconciliation evidence ingestion. Locked Material сохраняет только acquisition
CTA.

## 5. V1 requirements → surface/journey traceability

Таблица покрывает подтверждённый v1 product/application contract. `No UI` означает осознанное
отсутствие отдельной Platform surface, а не потерянное требование.

| ID | Requirement / invariant | Actor journey | Surface или `No UI` | Обязательные observable states/actions | Source |
|---|---|---|---|---|---|
| R01 | Public home с editorial discovery | Visitor/member открывает Platform и выбирает направление | Home | New feed, Topics, active Series, Карта; after login conditional Продолжить + short history | [Platform navigation][platform-brief-navigation] |
| R02 | Полный published catalog | Любой actor просматривает все карточки | Library | client-owned loading, populated, empty; card free/closed status; cursor continuation через automatic infinite scroll и явный fallback | [Workspace v1 scope][workspace-v1-scope] |
| R03 | Full-text search | Любой actor ищет RU/EN terms | Library/search | query, loading, results, no results, controlled failure; typo/normalization fixture | [Workspace search flow][workspace-search-flow] |
| R04 | Filters только из real metadata | Любой actor уточняет выдачу | Library/search | Тема/Формат/Серия; multi-select OR within facet, AND across facets; Tags visible/searchable | [Publishing audit navigation][audit-navigation] |
| R05 | Topic navigation | Любой actor открывает направление | Topic | description/context, Series и Material cards, empty/partial | [Platform navigation][platform-brief-navigation] |
| R06 | Ordered Series, включая closed Series visibility | Visitor видит description/order/cards; member читает episodes | Series | ordered episodes, free/closed/read status, empty/partial; no invented overall progress percent | [Platform actors][platform-brief-actors] |
| R07 | Editorial Roadmap | Любой actor понимает product directions и переходит к content | Roadmap | editorial body + curated/query links; partial links fail independently | [Workspace navigation roles][workspace-navigation-roles] |
| R08 | Public card/teaser каждого published Material | Visitor оценивает состав до покупки | Cards на Home/Library/Topic/Series/Roadmap и Material | free/closed label, title, description, cover, author, taxonomy/series, `publishedAt`; no closed body bytes | [Workspace public projection][workspace-public-projection] |
| R09 | Полное чтение free Material без account | Visitor открывает free card | Material | body, code/table/callout/media/file; optional primary Video section; loading/error; related content | [ContentAccess matrix][access-matrix] |
| R10 | Closed Material deny без утечки | Actor без доступа открывает closed card | Material | indexable public teaser + один `Получить доступ` CTA на configured Tribute URL; protected bytes absent | [Access copy boundary][access-copy] |
| R11 | Authenticated non-member closed state | Signed-in non-member открывает closed Material | Material + Account | Material показывает только общий `locked`; Membership details/recovery могут жить в Account; free content остаётся доступным | [Membership UX][membership-ux] |
| R12 | Protected reading | Active member или `materials:manage` opens body/image/file/video | Material | single authorize current published Material; conditional one-body load по `contentVersion`; resource unavailable локален | [ContentAccess matrix][access-matrix] |
| R13 | Expiry/removal preserves account context | Expired member returns to Platform | Material + Home/history + Account | closed access denied; account, Telegram link, history/read state preserved; automatic recovery after accepted event/reconciliation evidence | [Membership return flow][membership-return] |
| R14 | One closed access tier | Visitor/member crosses access boundary | Material/Account | only free vs Membership; no plan selector, upsell matrix or per-series purchase state | [Workspace v1 scope][workspace-v1-scope] |
| R15 | Email registration/sign-in | Visitor creates/resumes Platform identity | Sign-in handoff | one email-code flow creates/opens account; delivery/input/resend/rate/error/success; then skippable linking prompt | [Identity UX proof][identity-flow] |
| R16 | Explicit Telegram link after login | Authenticated human links identity | Account → short-lived Telegram bot `/start` → Account confirmation/result | unlinked, linking, linked+member, linked+not-member, expired/replayed, conflict, unavailable, recovery-required | [Membership UX][membership-ux], [membership failures][membership-failures] |
| R17 | Membership projection/rejoin | Linked non-member/expired member rejoins externally | Account | local current state, automatic update after accepted event/reconciliation evidence, stale/unavailable fail-closed; optional `Обновить состояние` only repeats local read; locked Material keeps only acquisition CTA | [Membership states][membership-states] |
| R18 | Secure unlink/recovery boundary | Authenticated human handles exceptional link problem | Account/support handoff | no casual replace; explicit confirmation/recent re-auth where allowed; conflict requires audited owner recovery | [Telegram link invariants][membership-link-invariants] |
| R19 | Read/unread state | Member explicitly toggles status for a Material | Material card/page; personal history | manual read/unread with mutation feedback; no auto-scroll/time/video trigger, percent, position or achievements | [Platform navigation][platform-brief-navigation] |
| R20 | Minimal recent history | Member returns to recently viewed content | Short Home layer + full Account history | empty/populated; survives Membership expiry; length/retention and unpublish behavior remain implementation inputs | [Platform actors][platform-brief-actors] |
| R21 | Related Materials | Reader continues to relevant content | Material | metadata-generated links + explicit author pins; empty/partial | [Workspace search flow][workspace-search-flow] |
| R22 | Text/guides/images/links/files + one primary Video | Reader consumes all v1 content shapes | Material | long-form body; code/table bounded overflow; callout; image alt/caption; file label/download; separate Video frame before body | [Authoring schema][authoring-schema] |
| R23 | Kinescope playback | Free/active/author actor plays allowed Video | Material/Preview | placeholder/loading, ready/play, access denied, unsupported/error, provider unavailable; no public fallback | [Kinescope player contract][kinescope-player] |
| R24 | Author Material management | Author creates/finds draft, published or unpublished Material | Author material list | loading, empty, filters/status if evidence proves need, create/open, finite lifecycle distinction | [Workspace modules][workspace-modules] |
| R25 | Structured full-state editor | Author edits body, metadata, relations, access и publication | Author editor | dirty/saving/saved, validation warnings/errors, current `contentVersion`, long content; published Save immediately live | [Authoring UX][authoring-ux] |
| R26 | Image/file upload and attach | Author uploads resource, finalizes, attaches | Author editor/resource picker | pending, uploading/progress, processing/finalizing, ready, failed/retry, invalid type/size, unavailable | [Workspace asset flow][workspace-resource-flow] |
| R27 | Kinescope upload/process/attach | Author uploads or attaches Video and waits for readiness | Author editor/video picker outside body editor | upload created/uploading/paused/processing/ready/failed/retry; only ready may become `primaryVideoId` on Save | [Kinescope lifecycle][kinescope-lifecycle] |
| R28 | Validation and current saved preview | Author checks publishability and rendered result | Editor + Preview | valid, warnings, structured errors, dependency unavailable; preview current saved state, no-store | [Workspace authoring flow][workspace-authoring-flow] |
| R29 | Optimistic conflict | Author/MCP saves stale Material | Editor conflict state; MCP structured outcome | `expectedContentVersion`, `409`, current version, preserved local input, manual reapply/reload; no last-write-wins | [Workspace authoring flow][workspace-authoring-flow] |
| R30 | Mutable lifecycle without history | Author manages lifecycle | Editor + Preview | `draft → published ↔ unpublished`; hard-delete only never-published draft; no revisions/compare/restore or mutation journal | [Workspace authoring flow][workspace-authoring-flow], [ADR 0009](../adr/0009-one-mutable-material.md) |
| R31 | MCP parity and authority | Delegated agent creates/edits/previews/publishes content | `No UI` for MCP; outcomes visible in Author surfaces | same full-state Save, validation and `409`; user-delegated Account with `materials:manage`; no separate owner GO | [Workspace MCP flow][workspace-mcp-flow] |
| R32 | Manual recreation, no Telegram import | Author recreates current content in target structure | Author editor only; `No UI` for importer/migration | no import wizard, mapping report, dedupe or migration progress | [Workspace v1 scope][workspace-v1-scope] |
| R33 | Telegram announcements/community remain external | Reader follows existing community lifecycle outside Platform | `No UI` required for messaging/comments; optional external link only after separate decision | no Platform comments, notification center, bot commands or mandatory per-Material discussion link | [Workspace v1 scope][workspace-v1-scope] |
| R34 | Platform does not bill/manage subscription | Visitor sees inline Membership offer and completes acquisition externally | Closed Material offer; `No UI` for checkout/subscription management | `Получить доступ` opens one Platform-configured Tribute URL; no per-Material URL, prices/plans/payment history/cancel controls or entitlement inference from click | [Platform actors][platform-brief-actors] |
| R35 | Single author, no editorial team/UGC | Кирилл completes whole publish flow | Author surfaces | no role assignment, review queue, collaborative cursors/comments or contributor onboarding | [Platform author][platform-brief-author] |
| R36 | Safe public/protected separation | Any actor opens cached/public/protected path | All public/Material surfaces | public projection survives; protected content is private/no-store; dependency failure never falls back open | [Workspace read flow][workspace-read-flow] |
| R37 | SEO for discoverable public value | Search crawler/public visitor reaches content | Home/Topic/Series/Roadmap/cards/free and locked Material teasers; Library route metadata | Content surfaces use SSR, stable canonical URLs, public metadata, sitemap and crawlable links; Library keeps canonical URL/metadata but its catalog is client-owned; protected body/resources absent, private surfaces noindex | [Workspace SEO][workspace-seo] |
| R38 | Accessible responsive critical journeys | Keyboard/screen-reader/mobile user navigates/reads/links/plays/authors | All browser surfaces | semantic headings/landmarks, visible focus, names, announced errors; non-pointer alternatives; zoom/narrow/reduced motion safe | [Workspace accessibility][workspace-accessibility] |
| R39 | Measured performance budgets | Visitor uses public/search/protected non-video pages | Home/Library/Topic/Series/Roadmap/Material | loading/partial UI must not hide failures; budgets verified on fixed corpus, not designed visually here | [Workspace performance][workspace-performance] |
| R40 | Deferred capabilities stay absent | Any actor uses v1 | `No UI` | no AI search, notifications/email center, advanced progress, assignments, achievements, gamification, multi-tier/billing, comments/community | [Workspace v1 scope][workspace-v1-scope] |

## 6. Confirmed state rules across surfaces

Эти правила ограничивают будущую actor × surface × state matrix; они не задают layout.

1. Public/free content остаётся доступным при identity, Membership, storage или video dependency
   failures настолько, насколько его isolated public projection/resource не зависит от упавшей
   системы. Closed content всегда fails closed. ([ContentAccess outage matrix][access-outages])
2. Deny закрытого Material показывает только public teaser и coarse recovery state. Closed body,
   draft, private locator, signed URL и playback token не должны попасть в HTML, RSC, search или
   shared cache. ([Workspace public projection][workspace-public-projection],
   [Workspace read flow][workspace-read-flow])
3. Resource failures локальны, когда это безопасно: недоступный video не делает недоступным уже
   разрешённый text body; страница сохраняет title/poster и controlled unavailable message.
   ([Kinescope outage][kinescope-outage])
4. Linking и Membership независимы. Возможны linked + not member, linked + unavailable и linked +
   expired; removal не удаляет link/account/history. ([Membership UX][membership-ux],
   [Membership states][membership-states])
5. Publication state сильнее reader bypass: обычный read/download/play никогда не открывает
   `draft` или `unpublished`, даже для `materials:manage`; author preview показывает current saved
   Material. ([ContentAccess matrix][access-matrix])
6. Save conflict — first-class state: stale `expectedContentVersion` возвращает `409` и current
   version, сохраняет local input и не выполняет last-write-wins. ([Workspace authoring flow][workspace-authoring-flow])
7. Asset/Video может быть опубликован только в `ready` state. Unknown provider status, processing,
   mismatch или outage не превращаются в optimistic ready. ([Workspace resource flow][workspace-resource-flow],
   [Kinescope lifecycle][kinescope-lifecycle])
8. Error/validation status должен быть programmatically announced; upload, player, table, code,
   editor and access-state controls имеют keyboard/non-pointer path. ([Workspace accessibility][workspace-accessibility])

## 7. Actor × surface × state × allowed action

Матрицы ниже описывают observable UX contract. Они не являются authorization policy: browser
получает coarse outcome от application layer, а не вычисляет Membership по actor name.

### Public, discovery и reading surfaces

| Surface | Actor | Observable state | Разрешённые действия | Запрещённое следствие |
|---|---|---|---|---|
| Root | Любой browser actor | Redirect на `/library` | Продолжить в Базу знаний | Не поддерживать вторую public content composition |
| Library/search | Все | Client loading / searching / results / no results / controlled failure; published membership cards locked без доступа и unlocked для active member/manager | Мгновенно применить/сбросить real-data filters без page navigation, ввести debounced query, автоматически догрузить cursor continuation, открыть card | Не искать client-side по закрытому body, не выдумывать facets и не публиковать cursor в URL |
| Topic | Все | Ready / empty / partial | Открыть Series или Material, перейти в Library с Topic context | Не хранить отдельную копию Material metadata |
| Series | Все | Ready / empty / partial / long ordered list | Открыть episode; authenticated actor видит read/unread | Не скрывать порядок closed Series и не вычислять percent complete |
| Roadmap | Все | Ready / partial links / editorial empty | Следовать curated/query links в generated views и Materials | Не превращать Roadmap в Topic, Series или duplicated catalog |
| Free Material | Все | Body ready / loading / long / resource partial | Read, play/download free Resources, открыть related; authenticated — mark read/unread | Не требовать account или Membership |
| Closed Material | Любой actor без доступа | Indexable public teaser + `locked` | `Получить доступ` → configured Tribute URL; продолжить public/free navigation | Не fetch/render closed body, inline media, download locator или Video token; не раскрывать точную deny reason |
| Closed Material | Active member | `allowed`, current published Material | Read body; отдельно authorize image/download/video; mark read/unread | Не reuse одного allow для другой Resource/Action или изменившейся `contentVersion` |
| Closed Material | Author | `allowed_by_permission` для current published read; Preview для любого lifecycle state | Read published или открыть explicit Preview | Не открывать draft/unpublished через public URL и не превращать permission в fake `MembershipEntitlement` |
| Resource внутри allowed Material | Allowed actor | Loading / ready / unavailable; Video также processing/unsupported | Read/download/play только конкретную Resource; retry bounded failure | Не делать весь text body недоступным из-за одного Video/Asset |
| Related Materials | Все | Populated / empty / partial | Открыть public card | Не объяснять internal score и не обещать AI recommendations |

### Account, linking и authoring surfaces

| Surface | Actor | Observable state | Разрешённые действия | Запрещённое следствие |
|---|---|---|---|---|
| Sign-in handoff | Public visitor | Start / code sent / input / rate-limited / failed / success | Ввести email/code, resend when allowed; после success связать Telegram или пропустить; return | Не принимать Membership решение внутри identity UI |
| Account | Authenticated unlinked/linking Account | `telegram_not_linked` или pending short-lived attempt | Start Telegram link, открыть bot `/start`, подтвердить или безопасно повторить истёкшую попытку, sign out | Не предлагать заменить уже связанную identity без recovery policy |
| Account | Linked non-member / expired | Linked identity + inactive/stale/unavailable coarse state | Обновить только local state, открыть approved acquisition destination | Не показывать raw Telegram status, Membership/evidence timestamps или provider data как authority |
| Account | Active member | Linked + active coarse state | Open Library/history | Не давать Platform subscription management |
| Account | Account с `materials:manage` | Явный authoring entry | Открыть существующую админку | Не показывать authoring entry без permission |
| Account link result | Authenticated human | Pending / linked-active / linked-inactive / expired / replay / conflict / unavailable / recovery-required | Finish или retry safe step; conflict и unsafe recovery — optional configured support link либо owner-handoff text | Не auto-merge two Accounts, silently replace link или превращать истечение conflict TTL в self-service relink |
| Recent history | Authenticated human | Empty / populated / referenced Material unpublished | Open still-visible Material, mark read/unread, return to Library | Не grant closed access from historical presence |
| Author material list | Author | Loading / empty / populated / controlled failure | Create Material, open draft/published/unpublished item | Не показывать author actions обычному member |
| Author editor | Author | Clean / dirty / saving / saved | Edit full state; validate; attach ready Resources; Preview; Save, включая publish/unpublish/access | Не publish invalid or processing Resource optimistically |
| Author editor | Author | Validation warning/error | Navigate to field/block, fix, validate again | Не сводить structured errors к одному toast |
| Author editor | Author/admin | Uploading / processing / failed / ready | Pause/retry where supported, edit metadata, attach only when ready | Не сохранять blob/provider URL в canonical document |
| Author editor | Author/admin | `409 conflict` | Preserve local input, inspect current version, manually reapply or reload | Не last-write-wins и не overwrite молча |
| Author preview | Author/admin | Loading / current saved state / resource unavailable / validation blocked | Inspect responsive reading and return to editor | Не mutate Material или publication state |
| MCP | Owner agent | Same validation/conflict/lifecycle/collection outcomes, structured | Управлять Material, Topic, Series и ordered composition | Не borrow human session/Membership и не access SQL directly |

### Обязательный state inventory

| State class | Где минимум проверяется | Recovery / announcement contract |
|---|---|---|
| Loading | Home, Library, Material, Account, author list, Preview | Сохранять page landmark/title; status объявляется без focus theft |
| Empty | Library before content, no search results, Topic/Series, history, author list | Объяснить, что отсутствует, и дать один contextual next action |
| Partial | Home/Roadmap links, cards without optional media, Material with failed Resource | Сохранить доступную часть; локально назвать недоступную часть |
| Validation | Account identity/link inputs; editor metadata/document/resources | Связать summary с конкретными fields/blocks; focus first error по action |
| Conflict | Editor/MCP stale `expectedContentVersion` | Сохранить local input, показать current version и safe manual reapply/reload path |
| Access denied / expired | Closed Material, Asset, file, Video | Только public teaser + `locked` + один `Получить доступ` CTA |
| Dependency unavailable | Identity, Telegram evidence, search, storage, Kinescope | Public/free independent content остаётся; protected operation fails closed |
| Upload / processing | Image, file, Video in editor | Programmatic progress/status; cancel/retry если adapter поддерживает; publish blocked до `ready` |
| Long content | Material, Series, editor/Preview | Heading navigation, stable reading order, bounded horizontal overflow code/table |
| Success | Link, full-state Save, publish/unpublish, read-state mutation | Название action совпадает с result copy; success не скрывает new current state |

## 8. Owner-approved fixture corpus

Статус corpus: **owner делегировал selection и утвердил F1–F3 как representative input**. Это
sanitized composite из типов контента, подтверждённых publishing audit; он не является verbatim
копией Telegram и не утверждает seed taxonomy. Один и тот же corpus без переписывания copy
используется в content-schema tests и как representative input UI laboratory и owning production
surfaces. Этот brief определяет presentation coverage corpus, а application specification — его
typed fixture boundary и production integration.

### F1 — free long-form guide

| Field | Value |
|---|---|
| Fixture ID | `material-public-agent-skills` |
| Title | Публичные skills для agent-first setup |
| Description | Как превратить повторяемый инженерный процесс в короткую repository-owned инструкцию, которую человек и агент выполняют одинаково. |
| Access / status | `free`, `published` |
| Topic / Format | Candidate Topic `AI-first engineering`; candidate Format `Guide` |
| Tags | Candidate values `agent skills`, `harness`, `engineering workflow` |
| Series | Нет |
| Search probes | `agent skills`, `скиллы для агента`, `harness workflow`, `repository instructions` |

Canonical copy sheet для body:

> Хороший skill начинается не с большого prompt, а с повторяемого решения. Он объясняет, когда
> workflow нужен, какие факты считать authority, где проходит owner gate и чем доказать результат.

#### Сначала найдите устойчивый seam

Берите процесс, который уже несколько раз прошёл руками: review, release preparation или
диагностику сложной ошибки. Запишите вход, observable result и границу ответственности. Общие
советы без конкретного consumer не становятся отдельным skill.

> **Важно.** Skill дополняет project rules, но не отменяет их. Repository-owned `AGENTS.md`,
> product contract и tests остаются authority для конкретной работы.

```ts
type SkillCheck = Readonly<{
  trigger: string
  ownerGate: string | null
  evidence: readonly string[]
}>

export const isReady = (check: SkillCheck) =>
  check.trigger.length > 0 && check.evidence.length > 0
```

| Signal | Хороший контракт | Плохой контракт | Evidence |
|---|---|---|---|
| Trigger | Называет наблюдаемую ситуацию | «Используй всегда» | Запрос однозначно маршрутизируется |
| Authority | Ссылается на owning source | Копирует устаревающий документ | Изменение проверяется по canonical file |
| Gate | Говорит, где нужен owner | Молча принимает product decision | Decision остаётся audit-able |
| Done | Называет проверку результата | Заканчивается после генерации текста | Test, diff или rendered evidence зелёные |

Следующий шаг — проверить instruction на двух разных задачах. Если обе требуют длинных исключений,
граница выбрана плохо: сузьте trigger или разделите workflow по разным outcomes.

Resources внутри F1:

| Kind | Local fixture ref | Public metadata / stress role |
|---|---|---|
| Image | `asset-skill-routing-map` | Alt: «Маршрут запроса от project rules через skill к проверяемому результату»; caption: «Один authority, один workflow, одна проверка»; aspect ratios 16:9 и 4:3 renditions |
| File | `asset-agent-skill-checklist` | Label: «Чек-лист проверки repository-owned skill перед публикацией»; filename stress: `agent-first-skill-review-checklist-public-v1.md`; 48 KB |
| External link | `link-skill-example-repository` | Label: «Пример repository-owned workflow»; sanitized placeholder destination заменяется approved public URL до production |

### F2 — closed flagship Series episode

| Field | Value |
|---|---|
| Fixture ID | `material-platform-build-05` |
| Title | Создание Platform Inside — 5. Developer Pipeline и owner-controlled delivery |
| Description | Разбираем, как связать issue, task branch, evidence, pull request и явный owner GO в один проверяемый delivery flow. |
| Access / status | `membership`, `published` |
| Topic / Format | Candidate Topic `Product engineering`; candidate Format `Video` |
| Tags | Candidate values `platform build`, `developer pipeline`, `harness` |
| Series | Candidate Series `Создание Platform Inside`, ordinal `5`; предыдущий/следующий episode нужны как cards, а не copied content |
| Search probes | `developer pipeline`, `owner go`, `ветка задачи`, `platform build harness` |

Canonical copy sheet для body:

> Developer Pipeline связывает работу с одним observable outcome: issue хранит intent, task branch
> изолирует изменение, evidence доказывает результат, а pull request делает решение проверяемым.

#### От ready issue к task branch

Перед изменениями проверьте owning repository, acceptance criteria и blockers. Ветка начинается от
актуального `main`, а worktree не меняет checkout владельца. Если задача затрагивает несколько
repositories, каждый implementation outcome получает собственный child issue и PR.

> **Owner gate.** Статус Review означает, что implementation и evidence готовы к решению. Merge
> всё равно выполняется только после явного owner GO.

```text
issue Ready
  -> task worktree
  -> focused change
  -> verification evidence
  -> Standards + Spec review
  -> pull request Review
  -> owner GO
```

| Stage | Authority | Required evidence | Owner action |
|---|---|---|---|
| Ready | Issue | Result, scope, acceptance, blockers | Уточнить только open product decisions |
| In progress | Task branch | Focused diff и local checks | Не требуется для reversible implementation |
| Review | Pull request | Verification, Not tested, open decisions | Проверить outcome and evidence |
| Merge | `main` | Green required checks and resolved review | Дать explicit GO |

Для этого выпуска smoke-команда выглядит коротко, но результат фиксируется полностью:

```bash
pnpm check
git diff origin/main...HEAD --check
```

Diagram ниже показывает не Git internals, а ownership: discussion остаётся в issue, durable
decision — в owning document, code — в application repository. Excalidraw source приложен, чтобы
автор мог обновить схему вместе с process contract. Видео проходит отдельный exact `play` access
decision; отсутствие playback не скрывает доступный текст.

| Resource | Local fixture ref | Metadata / state coverage |
|---|---|---|
| Image | `asset-pipeline-stage-map` | Alt: «Пять стадий delivery от ready issue до owner-approved merge»; wide 21:9 stress + mobile rendition |
| File | `asset-pipeline-stage-map-source` | Label: «Исходная схема Developer Pipeline»; filename `inside-platform-developer-pipeline-stage-map.excalidraw`; 2.4 MB |
| Primary Video | `video-platform-build-05` | Title: «Создание Platform Inside, выпуск 5»; отдельная section между summary и body; states idle/loading/ready/locked/failed/unavailable |

F2 является одним end-to-end representative Material: его title/description/body, code, table,
callout, image, file, primary Video и Series metadata используются вместе в reader, editor, Preview,
search/access tests и production surfaces.

### F3 — closed search/card diversity

| Field | Value |
|---|---|
| Fixture ID | `material-career-resume` |
| Title | Гайд на поиск работы и резюме в IT |
| Description | Практический разбор воронки поиска, структуры резюме и проверки гипотез без массовых безадресных откликов. |
| Access / status | `membership`, `published` |
| Topic / Format | Candidate Topic `Карьера`; candidate Format `Video` |
| Tags | Candidate values `job search`, `resume` |
| Series | Нет |
| Resources | File `find_job.excalidraw` с label «Карта поиска работы»; primary Video `video-career-resume` вне body |
| Search probes | `поиск работы резюме`, `job search`, `резюмэ`, `карта поиска работы` |

### Corpus stress profile и sanitation

| Dimension | Fixture evidence |
|---|---|
| Typography/density | F1 long title/description, paragraphs, headings, blockquote/callout, four-column table and code; F2 wide table and 21:9 image |
| Search | RU/EN mixed queries, typo `резюмэ`; public actors match title/description/taxonomy, allowed actors additionally match protected body/asset labels |
| Free/closed access | F1 free Resources; F2/F3 locked teaser with one CTA or allowed Membership body/Asset/download/Video |
| Authoring | Every v1 node family appears across F1/F2; metadata, multi-Series-capable model, upload/processing, validation and conflict cases |
| Long/mobile | 80+ character title, long filename, wide table/code, portrait/narrow and desktop media cases |
| Sanitation | Fictional local IDs; no emails, Telegram handles, tokens, secrets, private URLs, provider IDs, personal documents or real participant data |

## 9. Low-fidelity responsive wireframes

Owner decision #195 supersedes Home/global-navigation fragments in the older wireframes below:
production starts at `/library`, global navigation contains only «База знаний», and the accepted
Library/Topic/Series compositions are the real-data implementations from #203 and #216. The older
Home frames remain only as historical rationale for hierarchy, not as a current surface contract.

Wireframes encode hierarchy and reading/keyboard order only. Brackets mean a semantic region or
control, not a component, border, color, spacing token or visual style. Owner-approved compact IA:
top-level `Главная`, `Библиотека`, `Карта`; Topic/Series are contextual; Account/Author are actor
utilities.

### Mobile: global shell, Home и Library

```text
[skip to content]
[Inside]                         [Menu] [Account/Sign in]

HOME                              LIBRARY
[h1: Главная]                     [h1: Библиотека]
[Continue reading — if history]   [search input — applies automatically]
[short recent history]            [Filters: Тема / Формат / Серия]
[h2: Новые материалы]             [active filter summary] [Clear]
[Material card]
[Material card]                   [result count / status]
[h2: Темы]                        [Material result card]
[Topic links]
[h2: Активные серии]              [Material result card]
[Series link + ordered context]   [auto load sentinel / Load more fallback]
[Roadmap entry]

[footer navigation]
```

Home content priority after sign-in: page purpose → continuation when present → short history → new
feed → Topics → active Series → Карта. Anonymous Home omits personal regions. Library priority:
query → multi-select filter state → result status → results. Query/filter changes replace the
canonical URL state without page navigation; cursor continuation stays internal. Empty/no-results
replaces only the result region and keeps query/clear action.

### Desktop Home and responsive Topic / Series / Roadmap

```text
DESKTOP HOME
[Inside] [Главная] [Библиотека] [Карта]                         [Account]
[h1 Главная]
[Continue reading + short history — conditional]
[h2 Новые материалы] [feed card] [feed card] [feed card]
[h2 Темы]            [Topic link] [Topic link] [Topic link]
[h2 Активные серии]  [Series summary + current ordered entries]
[Карта entry]

NARROW TOPIC               NARROW SERIES              NARROW ROADMAP
[context: Библиотека]      [context: Topic]           [h1 Карта]
[h1 Topic]                 [h1 Series]                [editorial intro/body]
[description]              [description]              [direction heading]
[related Series]           [ordered episode card]     [Topic/Series/Material links]
[Material card]            [ordered episode card]     [direction heading]
[Material card]            [empty/partial status]     [links / partial status]
[Library with Topic]       [related Topic]            [Library entry]

DESKTOP GENERATED/EDITORIAL VIEW
[breadcrumb/context] [h1 + description]
[optional related navigation]
[generated Material/Series region OR Roadmap editorial body + curated/query links]
[empty/partial status local to the affected region]
```

Keyboard order for Home and these destinations is header → `h1`/description → contextual links →
main generated/editorial regions in document order → continuation/footer. Desktop placement does
not move Topics/Series/Roadmap links ahead of their headings or change mobile reading order.

### Desktop: Library/search

```text
[skip]
[Inside] [Главная] [Библиотека] [Карта]                    [Account]

[h1 Библиотека]                         [search________________] [Найти]
[result status / error announcement]

[filters landmark]                      [results landmark]
 Тема [multi-select]                     [card: title, description, Topic/Format]
 Формат [multi-select]                   [free/closed + Series/read state]
 Серия [multi-select]                    [card]
 [Сбросить]                              [card]

                                         [continuation control]
```

DOM/keyboard order remains: skip → header/nav → `h1` → search → filters → result status → cards →
continuation → footer. Desktop columns must not reorder focus relative to mobile.

### Mobile: Material in allowed and denied states

```text
[back/context: Topic / Series]
[access + Format metadata]
[h1 Material title]
[description]
[series position + read/unread action when authenticated]

ALLOWED                            DENIED / OFFER
[primary video player/status]      [no video presentation/locator]
[body heading navigation]          [public teaser]
[paragraph/callout/code/table]      [coarse state heading]
[image + alt/caption]               [state explanation]
[file label + Download]             [Получить доступ -> configured Tribute URL]
[related Materials]                [public related Materials]
```

Denied DOM contains no hidden closed body or Resource locators. In allowed state, code/table may
scroll horizontally inside their own labelled region; page itself does not acquire horizontal
scroll. A failed Video leaves text, caption/poster and a local retry/unavailable message.

```text
DESKTOP MATERIAL
[global nav] [breadcrumb: Topic / Series]
[main reading column: metadata -> h1 -> description -> body/resources]
[context region: series position -> manual read state -> heading navigation]
[inline Membership offer replaces body when denied]
[related Materials after main reading region]
```

Desktop keyboard order stays breadcrumb → title/description → read-state action → heading navigation →
body/resources → related Materials. A side context region is visually repositioned only; its DOM
order does not interrupt heading/body sequence.

### Mobile: Account / Telegram linking

```text
[h1 Аккаунт]
[email identity]
[h2 Telegram]
[link state: not linked | linking callback pending | linked]
[Membership coarse state]
[primary recovery action]
[safe explanation: what linking does / does not do]
[sign out]

post-sign-in onboarding while Telegram is unlinked:
[compact centered modal, once per authenticated browser session]
[Telegram icon] [Закрыть]
[Подключите Telegram]
[one short Telegram-only explanation]
[Подключить Telegram]
[begin → external Telegram /start → Проверить связь]
[Telegram подключён | conflict | unavailable remains visible]
[no Membership state or acquisition CTA]
```

The first action is derived from coarse outcome. Link status and Membership status stay separate
lines so `linked + inactive` cannot read as a broken login. Dismissal survives navigation and reload
inside the current authenticated browser session; logout or a confirmed guest state resets it, so
an unlinked Account receives the prompt again after the next sign-in.

```text
DESKTOP ACCOUNT
[Account nav] [h1 Аккаунт]
[identity and Telegram/link state]     [full recent history]
[Membership coarse state/actions]      [Material history row + manual read state]
[sign out]                             [empty/unpublished row state]
```

Account keyboard order is identity → Telegram linking → Membership recovery → history → sign out,
even if desktop columns place sign out visually on the left.

### Author material list: desktop and narrow mobile

```text
DESKTOP
[Author nav] [h1 Материалы] [Создать материал]
[search/status controls]
[list row: title | draft/published/unpublished | updated | validation | Open]
[list row]
[empty/error/continuation state]

NARROW MOBILE
[Author nav]
[h1 Материалы]
[Создать материал]
[search/status disclosure]
[Material row: title]
[draft/published/unpublished + updated + validation]
[Open]
[next row / empty / error]
```

Keyboard order is nav → `h1` → create → list search/status controls → rows/actions → continuation.
The status controls are optional until real list size proves them; loading/empty/error regions keep
the Create action available.

### Desktop and narrow mobile: Author editor / Preview

```text
DESKTOP
[Author nav] [Material title/status] [saved state] [Preview] [Save]
[metadata: Topic / Format / Tags / Series / access]
[publication state: draft / published / unpublished]
[document outline] [editor document: text + block insert/reorder] [validation panel]
[resource status: upload / processing / ready / failed]
[current contentVersion]

NARROW MOBILE
[Back] [Material status]
[h1 Edit Material]
[saved/conflict status]
[Metadata disclosure]
[Document toolbar]
[editor in document order]
[Resources]
[Validation summary]
[Preview]
[Save]
```

Keyboard order follows document meaning, not desktop columns: header actions → metadata → editor
toolbar/document → resources → validation → Save. Validation summary links to exact field/block.
On `409`, local input остаётся в editor, а inline conflict region предлагает `Reload current` или
manual reapply после просмотра current state; default action never overwrites.

### Preview and lifecycle Save

```text
[Preview banner: current saved contentVersion + access/publication state]
[viewport switch is optional test utility, not content control]
[rendered Material in the same reading order]
[resource unavailable states]
[Back to editor] [Run validation]

[editor Save summary]
[changed content/metadata/access/publication state]
[validation result]
[Save] [Cancel]
[saving status -> current canonical/preview link]
```

Preview uses the production renderer contract but remains private/noindex/no-store. Viewport proof
must additionally test a real narrow browser; a visual frame switch alone is not responsive evidence.
Save is one atomic application command. Moving to `published` requires complete valid state and ready
resources; saving an already published Material makes the new current state live immediately.

## 10. Owner-approved coarse UX copy contract

| Outcome | Heading | Explanation | Primary action |
|---|---|---|---|
| Locked published Material | Материал доступен по Membership | Получите доступ, чтобы открыть этот и другие закрытые материалы. | Получить доступ → configured Tribute URL |
| Video unavailable inside allowed body | Видео временно недоступно | Текст материала и другие доступные файлы остаются на странице. | Повторить |
| Search no results | Ничего не найдено | Измените запрос или сбросьте фильтры. | Сбросить фильтры |
| Empty history | Здесь появятся недавние материалы | Откройте материал, чтобы быстро вернуться к нему позже. | Открыть Библиотеку |
| Editor validation failed | Материал пока нельзя опубликовать | Исправьте отмеченные поля и blocks, затем повторите проверку. | К первой ошибке |
| Editor conflict | Материал изменился в другой сессии | Ваши изменения сохранены локально. Перезагрузите current state или перенесите их вручную. | Показать текущую версию |

Controls use the same verb as their result: `Сохранить` → `Сохранено`, `Опубликовать` →
`Опубликовано`, `Подключить Telegram` → `Telegram подключён`. Copy never claims payment/subscription
state, provider failure or permanent access. `Получить доступ` is an ordinary outbound link to one
Platform-configured Tribute URL; Platform does not consume Tribute API/webhooks and never uses the
click or payment page as `MembershipEvidence`.

## 11. Remaining implementation inputs

Owner-approved UX structure is complete. Ни один оставшийся пункт ниже не блокирует #20, но его
нельзя тихо превратить в product promise во время owning production implementation.

| Input | Что уже подтверждено | Что решается позже | Owner stage |
|---|---|---|---|
| Exact v1 formatting limits | F1/F2 establish headings, paragraph, blockquote/callout, code, table, image, file and video minimum | Strike/nested-list need, heading levels, table/code/document size limits from real corpus and schema tests | Content-schema implementation |
| Concrete taxonomy values | F1–F3 labels are approved representative fixtures only; Material has one Topic/Format and 0..N Tags/Series | Production dictionaries and reviewed RU/EN synonyms emerge during manual authoring | Content filling / search proof |
| Home composition details | Conditional Продолжить, short history, new feed, Темы, active Серии and Карта are fixed | Curated/query source per block, item counts and exact responsive composition | Owning Home/Roadmap production Specification |
| Identity provider mechanics | One email-code UX creates/opens account; post-login linking is a centered, immediate but skippable session-scoped modal while Telegram is unlinked | Provider/fallback and Yandex horizon after identity proof | Stage 3 identity proof |
| Account linking/recovery | Telegram linking только после login; no auto-merge/transfer; Membership не unlink-ит identity; expired/replayed attempt можно начать заново; conflict/unsafe recovery остаются owner-mediated без self-service unlink/relink; support URL optional, иначе показывается owner-handoff text | Exact operational support destination and wording can change through runtime configuration/content review | Account operations |
| Telegram bot public identity | Dedicated branded bot и `/start` handoff confirmed; browser OIDC/callback не используется | Username, display name/avatar и owner/recovery account | Telegram handoff screens |
| Related Materials presentation | Metadata score + author pins confirmed | Count/order labels, distinction between pinned/generated if any, empty state | Material wireframe |
| Long-content and resource limits | Corpus names current stress cases: 80+ character title, four-column table, code, long filename, 21:9 image | Add measured document/table/code/file limits after schema implementation evidence | Owning content/Material implementation |
| Video unavailable/unsupported behavior | Text remains; no public fallback; controlled retry copy accepted | Choose supported-browser help destination; acceptable continued-play window comes from integration proof | Player implementation |
| Acquisition destination operations | One `Получить доступ` CTA and one Platform-configured Tribute URL are fixed; no integration or access inference | Link health/content ownership and safe operational update path | Production content/config |

Источник unresolved identity и UI decisions — merged specification и owning identity research.
([Workspace owner decisions][workspace-owner-decisions], [Identity open decisions][identity-open])
Taxonomy/formatting gaps явно сохранены research inputs. ([Authoring open decisions][authoring-open],
[Publishing audit boundary][audit-boundary])

## 12. Completion boundary

Документ содержит owner-approved actors/journeys/IA, R01–R40 traceability, actor × surface × state ×
allowed-action matrices, full state inventory, sanitized corpus, coarse copy и
mobile/desktop/keyboard-order wireframes. Он остаётся structural artifact: palette, typeface,
components, exact layout metrics, motion and visual signature развиваются из owner-taste input #21
сначала в bounded UI laboratory, затем в production adoption и owning surfaces по
[#19](https://github.com/sachkov-inside/platform/issues/19).

Open inputs из раздела 11 принадлежат своим owning implementation stages и не отменяют UX contract
#20. Visual brief #21 фиксирует direction hypotheses и owner-control boundary, но не объявляет
generated mockups pixel authority. UI laboratory не возвращает отменённые whole-screen concept и
standalone component proof gates #22/#23. Screenshots из audit остаются bounded evidence и не
объявляются полным catalog или seed taxonomy.
([Platform issue #20](https://github.com/sachkov-inside/platform/issues/20),
[Platform visual brief](platform-v1-visual-brief.md),
[Platform #19 owner decision](https://github.com/sachkov-inside/platform/issues/19#issuecomment-5382270492),
[Publishing audit limitations][audit-limitations])

## Source index

Platform-owned canonical sources use repository-relative links to their current version. External
Workspace provenance is pinned to exact commits. GitHub issues remain the primary task record.

[platform-brief-authority]: platform-mvp-brief.md
[platform-brief-outcome]: platform-mvp-brief.md#результат-первой-версии
[platform-brief-actors]: platform-mvp-brief.md#пользователи-и-доступ
[platform-brief-author]: platform-mvp-brief.md#автор
[platform-brief-navigation]: platform-mvp-brief.md#поиск-и-навигация
[platform-context]: ../../CONTEXT.md
[platform-spec-authority]: ../specifications/platform-v1.md#результат-и-authority
[platform-spec-boundaries]: ../specifications/platform-v1.md#application-boundaries
[platform-spec-logical-model]: ../specifications/platform-v1.md#logical-model-и-cardinalities
[platform-spec-nfr]: ../specifications/platform-v1.md#application-nfr

[product-value]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/product/README.md#L25-L46
[product-audience]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/product/README.md#L48-L66
[product-build-series]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/product/README.md#L82-L102

[workspace-v1-result]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L8-L34
[workspace-v1-authority]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L14-L34
[workspace-v1-scope]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L36-L68
[workspace-stack]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L96-L132
[workspace-modules]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L181-L212
[workspace-logical-model]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L214-L239
[workspace-navigation-roles]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L241-L247
[workspace-public-projection]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L249-L252
[workspace-authoring-flow]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L254-L265
[workspace-read-flow]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L267-L274
[workspace-resource-flow]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L286-L295
[workspace-search-flow]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L297-L304
[workspace-mcp-flow]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L306-L313
[workspace-seo]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L328-L335
[workspace-accessibility]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L337-L344
[workspace-performance]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L346-L360
[workspace-stage1]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L396-L404
[workspace-owner-decisions]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/specifications/platform-v1.md#L549-L562
[workspace-context]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/CONTEXT.md#L1-L40

[access-decision]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-content-access.md#L11-L31
[access-vocabulary]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-content-access.md#L93-L161
[access-matrix]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-content-access.md#L247-L277
[access-copy]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-content-access.md#L279-L314
[access-outages]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-content-access.md#L456-L469

[membership-ux]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-telegram-tribute-membership.md#L110-L124
[membership-return]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-telegram-tribute-membership.md#L126-L137
[membership-link-invariants]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-telegram-tribute-membership.md#L191-L205
[membership-states]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-telegram-tribute-membership.md#L495-L527
[membership-failures]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-telegram-tribute-membership.md#L570-L592
[identity-flow]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-identity-architecture.md#L292-L319
[identity-open]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-identity-architecture.md#L344-L355

[authoring-schema]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-content-authoring-model.md#L98-L130
[authoring-ux]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-content-authoring-model.md#L169-L186
[authoring-open]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-content-authoring-model.md#L500-L517
[kinescope-lifecycle]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-kinescope-video-lifecycle.md#L30-L77
[kinescope-player]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-kinescope-video-lifecycle.md#L305-L352
[kinescope-outage]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-kinescope-video-lifecycle.md#L354-L381

[audit-decisions]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-current-publishing-audit.md#L23-L38
[audit-boundary]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-current-publishing-audit.md#L274-L290
[audit-navigation]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-current-publishing-audit.md#L211-L237
[audit-limitations]: https://github.com/sachkov-inside/workspace/blob/ed5b555a0171a53ab17a5ed388d80575c8025f03/docs/research/platform-current-publishing-audit.md#L292-L312
