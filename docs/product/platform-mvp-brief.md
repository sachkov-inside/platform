# Sachkov Inside — brief первой версии платформы

Статус: подтверждённые owner decisions по 2026-08-27. Документ фиксирует продуктовую границу
первой версии будущего Inside-приложения. Он является входом в отдельные bootstrap, technical
discovery и delivery, но не выбирает stack, архитектуру или repository layout.

Authority этого brief находится в этом Platform repository. Обычные Git commits и pull requests
дают versioning, provenance и review. Общий Membership-контекст и cross-repository решения остаются
в [`sachkov-inside/workspace`](https://github.com/sachkov-inside/workspace).

## Результат первой версии

Первая версия делает собственную платформу основным домом материалов Inside. Она решает две
задачи:

1. участник Membership удобно находит, просматривает и читает весь доступный ему контент;
2. публичный посетитель видит реальный состав и ценность Membership до покупки.

Платформа становится source of truth полноценных материалов. Telegram остаётся местом community,
анонсов и внешнего Membership/access lifecycle. После появления рабочей платформы новые полные
материалы публикуются только на ней; в Telegram выходит анонс и ссылка.

## Пользователи и доступ

Public landing и Platform application являются разными surfaces. Landing объясняет предложение
Inside и ведёт в application/Мастерскую; application владеет discovery, free/closed Materials,
private Account, member-only Member Profile и reading experience. `sachkov.dev` и
`app.sachkov.dev` являются рабочими примерами этой границы, а exact production domains определяются
будущей release specification.

### Публичный посетитель

- без регистрации просматривает главную, темы, серии и Библиотеку;
- использует полнотекстовый поиск и фильтры;
- полностью читает выбранные бесплатные материалы;
- видит индексируемую карточку и публичные metadata каждого закрытого материала с замком;
- видит описание, порядок и карточки всех выпусков закрытой серии;
- на закрытом материале при любой причине deny видит один external CTA `Получить доступ` на общую
  Platform-configured Tribute URL; protected body и связанные ресурсы не загружаются.

### Участник Membership

- создаёт или открывает Account одним email-code sign-in flow без отдельной registration
  form;
- управляет private Account и отдельным Member Profile;
- видит Member Profiles других действующих участников;
- после первого входа получает предложение связать Account с Telegram, но может
  пропустить шаг и продолжить с бесплатным контентом;
- может позже связать Telegram из Account;
- получает доступ на основании внешнего признака активного Membership;
- имеет один уровень закрытого доступа без тарифной матрицы;
- после окончания Membership сохраняет Account, Member Profile, историю и статусы
  прочтения, но до возобновления Membership теряет доступ к закрытым материалам и Member Profiles
  других участников.

Account является приватной surface владельца: в ней находятся identity/security state,
Telegram linking, Membership state и recovery actions. Member Profile — отдельная проекция для
других действующих участников. Anonymous visitor, non-member и search crawler её не получают;
profile не индексируется и никогда не содержит email, Platform или Telegram internal identifiers,
Telegram username, linking/evidence, security или audit data. Exact поля, avatar, discoverability,
moderation и delete/disable policy утверждены владельцем в Platform #51: Profile содержит
обязательное изменяемое non-unique display name и optional bio, создаётся через обязательный
name-only onboarding после первого sign-in и открывается active members по opaque URL без directory
или search. Owner редактирует, экспортирует и удаляет Profile в private Account; optimistic version
защищает edit/delete, deletion очищает поля и не оживляет старый URL, а disabled state остаётся
виден только owner. Text reporting ограничен одним open report на viewer/Profile и обслуживается
ручной owner moderation. Avatar, любые image/file операции и S3 delivery вынесены в Platform #153 и
не блокируют text Profile vertical; это не расширяет brief до публичной социальной сети.

Платформа не принимает оплату и не управляет подпиской. Один outbound CTA ведёт на
Platform-configured Tribute URL: Platform не читает Tribute API/webhooks и не делает access decision
по клику или payment state. Trial, промокоды, подарки, временные доступы и продажа отдельных серий
не входят в первую версию. Внешним признаком Membership является участие в единственном
каноническом закрытом Telegram chat. Platform не выдаёт доступ по данным Tribute или другого
payment/roster operator; technical integration boundary описана в
[application specification](../specifications/platform-v1.md).

### Автор

В первой версии материалы создаёт и публикует только Кирилл. Роли редакторов, согласования между
несколькими авторами и user-generated content не нужны.

## Контент

Платформа хранит каноническую версию материала. Исходник можно подготовить в Obsidian, Telegram,
локальном файле, редакторе платформы или другом удобном месте, но после создания материала
authority находится в платформе.

Первая версия поддерживает:

- текст и структурированные guides;
- видео через Kinescope;
- изображения;
- ссылки;
- прикреплённые и скачиваемые файлы.

У материала есть четыре независимые оси организации:

1. **Topic.** В domain model сущность называется `Topic`, в русском интерфейсе — «Тема». У
   материала ровно одна тема. В первой версии темы одноуровневые, без подтем.
2. **Format.** Формат хранится отдельно от темы: видео, текст, guide и другие подтверждённые
   аудитом разновидности. У материала ровно один основной формат.
3. **Series.** Серия является упорядоченной последовательностью; в русском интерфейсе она
   называется «Плейлист». Материал может входить в ноль или несколько серий и иметь отдельную
   позицию в каждой.
4. **Tag.** Теги выбираются из управляемого словаря, отображаются пользователю, открывают похожий
   контент и могут использоваться в фильтрах. У материала может быть ноль или несколько тегов;
   их можно добавлять, переименовывать и объединять без создания дублей и синонимов.

Конкретный список тем, форматов, тегов и поисковых фильтров определяется по результатам аудита
реального контента, а не проектируется заранее.

На странице материала есть связанные материалы: система предлагает их по метаданным, а автор
может вручную закрепить особенно важные связи. Community и обсуждения остаются в Telegram, но
отдельная ссылка на обсуждение для каждого материала не является обязательной частью первой
версии.

## Поиск и навигация

Платформа использует несколько представлений одной content model:

- **Главная** — редакционная витрина и навигационная точка входа: новые и избранные материалы,
  темы, активные серии и быстрые переходы в разделы;
- **Библиотека** — полный список контента с полнотекстовым поиском и фильтрами;
- **страница темы** — краткая витрина направления с его сериями и материалами;
- **страница серии** — описание и упорядоченный состав выпусков.

Roadmap является редакционной навигационной страницей, «Создание Platform Inside» — упорядоченной
серией, а Библиотека — генерируемым представлением материалов, а не отдельной копией контента.

Structural UX этих поверхностей задан [UX brief](platform-v1-ux-brief.md), а owner-taste constraints
— [visual brief](platform-v1-visual-brief.md). [Platform #19](https://github.com/sachkov-inside/platform/issues/19)
поставляет их в одном production `apps/web` через параллельные, но сходящиеся delivery lanes:
backend/headless capabilities и owner-controlled UI foundation с последующей production
интеграцией. Shell из завершённой
[#36](https://github.com/sachkov-inside/platform/issues/36) является технической foundation и
временной visual заглушкой, а не принятой visual baseline. Exact UI laboratory, shell adoption и
surface integration order принадлежит
[application specification](../specifications/platform-v1.md#production-foundation-order).
Рабочее пользовательское название «Тема» можно заменить, если интерфейс покажет, что «Категория»
или другой термин понятнее.

После входа главная сохраняет ту же контентную основу, но показывает персональный слой: последний
просмотренный материал, историю и статусы прочтения. В первой версии прогресс ограничен признаком
`прочитано / не прочитано`; общий процент, сохранение позиции, статистика, achievements и
gamification не нужны.

Новые материалы анонсируются через Telegram. Внутренний notification center и email-рассылки
остаются будущими возможностями.

## Публикация и agent-first contract

Платформа имеет собственную закрытую админку для создания и редактирования текущего состояния
Material: content, metadata, series membership, assets, access и publication state.

MCP является обязательной частью первой версии. Админка и MCP используют один application API и
одни domain rules; MCP не обращается к базе напрямую. Agent interface должен позволять:

- создать never-published draft из предоставленного текста или файла;
- читать и изменять материал;
- загружать и привязывать assets;
- назначать тему, формат, теги и серии;
- получать preview текущего сохранённого draft и состояние validation;
- одним full-state Save изменять content, metadata, `free | membership` и
  `draft | published | unpublished`.

Агент с current `materials:manage` может самостоятельно выполнить тот же Save, включая первую или
повторную публикацию, unpublish и изменение access. Отдельного owner GO внутри product workflow
нет. Draft скрыт до первой публикации; после неё каждый успешный Save немедленно меняет живой
Material и его Library/search projection. Platform не хранит старые bodies, restore history или
durable mutation journal; stale concurrent Save отклоняется по current content version.

## Создание актуальных материалов

Актуальные материалы вручную заново создаются в Platform в удобной целевой структуре. Telegram
используется только как visual reference. Export, importer, source mapping, loss report,
deduplication и migration pipeline не нужны.

После запуска:

- новый полный материал появляется на платформе;
- Telegram получает анонс, ссылку и обсуждение;
- платформа остаётся каноническим источником опубликованной версии.

## Граница MVP

В первую версию входят:

- публичная главная, страницы тем и серий, Библиотека;
- публичные карточки закрытых материалов и полностью бесплатные материалы;
- полнотекстовый поиск и фильтры;
- email sign-in, private Account и связь с Telegram Membership;
- отдельный Member Profile, видимый только действующим участникам;
- чтение закрытого контента участником;
- статусы прочтения и минимальная история просмотра;
- собственная авторская админка;
- MCP поверх общего application API;
- ручное создание актуальных материалов без import pipeline;
- Kinescope как video provider.

За границей первой версии остаются:

- собственный billing и управление подпиской;
- несколько тарифов, trial, промокоды и продажа отдельных продуктов;
- комментарии и community внутри платформы;
- анонимно доступный или индексируемый internet-public profile, social graph, follows, direct
  messages и broad member directory;
- редакционные команды и материалы участников;
- сложный learning progress, задания, achievements и gamification;
- внутренние и email-уведомления;
- AI-поиск и отдельный autonomous content generation workflow вне user-delegated MCP Save.

## Связанные application-документы

- [Platform v1 application specification](../specifications/platform-v1.md) владеет modules,
  logical schema, flows, application NFR, production foundation order и ADR inputs.
- [`CONTEXT.md`](../../CONTEXT.md) задаёт канонические application terms без implementation
  details.
- [Platform #19](https://github.com/sachkov-inside/platform/issues/19) — root Specification для
  UI laboratory и production frontend integration; application specification владеет delivery
  order и provenance отменённых pre-production gates.
- [Platform #48](https://github.com/sachkov-inside/platform/issues/48) — root Specification для
  Identity, Account, Member Profile, authorization и Membership delivery.
- [Workspace #65](https://github.com/sachkov-inside/workspace/issues/65) и завершённая
  [#66](https://github.com/sachkov-inside/workspace/issues/66) — cross-repository authority и
  provenance для Platform/Telegram contract; Platform build и runtime от Workspace не зависят.

## Основания content model

- [GOV.UK Taxonomy principles](https://www.gov.uk/government/publications/govuk-topic-taxonomy-principles/govuk-taxonomy-principles) — тема описывает предмет материала, а taxonomy развивается по
  реально существующему контенту.
- [GOV.UK: Organise and group content](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/plan-manage-content/organise-group-govuk-content/) — topic navigation и отдельные collections решают разные задачи.
- [Contentful: Content models](https://www.contentful.com/help/content-models/) и
  [Sanity: Connected content](https://www.sanity.io/docs/studio/connected-content) — связанные
  сущности сохраняют content model переиспользуемой и расширяемой.
- [Algolia: Faceting](https://www.algolia.com/doc/guides/managing-results/refine-results/faceting) — facets строятся по выбранным устойчивым атрибутам и уточняют полнотекстовый поиск.
