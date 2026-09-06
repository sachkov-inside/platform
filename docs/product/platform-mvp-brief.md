# Sachkov Inside — brief первой версии платформы

Статус: подтверждённые owner decisions по 2026-09-06. Документ фиксирует продуктовую границу
текущей платформы Inside. Он является входом в отдельные bootstrap, technical
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

- без регистрации просматривает главную, темы, серии и Базу знаний;
- использует полнотекстовый поиск и фильтры;
- полностью читает выбранные бесплатные материалы;
- видит индексируемую карточку и публичные metadata каждого закрытого материала с замком;
- видит описание, порядок и карточки всех материалов закрытой серии;
- на закрытом материале при любой причине deny видит один external CTA `Получить доступ` на общую
  Platform-configured Tribute URL; protected body и связанные ресурсы не загружаются.

### Участник Membership

- создаёт или открывает Account кодом из почты либо подтверждением в Telegram-боте,
  без отдельной формы регистрации и ссылок «Ещё не зарегистрированы?» / «Создать аккаунт»;
  Telegram-вход доступен при серверном включении функции;
- управляет private Account и отдельным Member Profile;
- видит Member Profiles других действующих участников;
- после каждого входа, пока Telegram не связан, один раз за authenticated browser session видит
  центрированное onboarding-окно; может закрыть его и продолжить с бесплатным контентом;
- связывает Telegram целиком в onboarding-окне либо позже из Account: Platform выдаёт short-lived
  bot link, первое действие сразу открывает Telegram, участник отправляет `/start`, а после возврата
  Platform автоматически подтверждает связь и показывает явный success result;
- получает доступ на основании внешнего признака активного Membership;
- имеет один уровень закрытого доступа без тарифной матрицы;
- после окончания Membership сохраняет Account, Member Profile, историю и статусы
  прочтения, но до возобновления Membership теряет доступ к закрытым материалам и Member Profiles
  других участников.

Экран Telegram-входа содержит кнопку «Открыть бота» и короткий статус. Бот спрашивает
«Вы входите в Sachkov Inside?» и предлагает «Подтвердить вход» / «Отменить». После подтверждения
исходная вкладка автоматически завершает вход. После завершения связи с Account бот меняет
исходное сообщение на «Вход подтверждён. Вернитесь на сайт.» и убирает кнопки; при отмене
показывает «Вход отменён.». Предупреждения о связанных аккаунтах и
восстановлении, а также сверка числа не входят в этот экран по решению владельца 2026-09-06.
Существующий email Account можно связать с Telegram в кабинете и затем входить в тот же
Account через бота. Независимая регистрация создаёт отдельный Account без почты; автоматического
объединения аккаунтов и покупок нет. Добавление первой почты, замена Telegram и восстановление
доступа в эту поставку не входят. При потере Telegram поддержка не гарантирует восстановление.
Серверное выключение блокирует новые Telegram-входы, сохраняя email-вход и уже выданные сессии.

Account является приватной surface владельца: компактная голубая Telegram-плашка располагается над
отдельной premium-карточкой `Доступ к Sachkov Inside`. Карточка объясняет ценность подписки и для
inactive state показывает единый acquisition CTA; coarse состояния остаются независимыми, но не
выводятся как техническая диагностическая таблица. Linked Telegram не обещает access; Membership
timestamps, evidence, provider identity и internal identifiers не показываются. Компактное
onboarding-окно посвящено только подключению Telegram и после успеха показывает результат связи;
Membership state и acquisition action остаются только в Account и на закрытых материалах. Истёкшую обычную попытку
можно начать заново, а conflict или recovery с риском silent
transfer ведут только к owner/support handoff; URL поддержки является optional runtime setting и
при его отсутствии заменяется безопасным текстом без неработающей ссылки. Member Profile — отдельная проекция для
других действующих участников. Anonymous visitor, non-member и search crawler её не получают;
profile не индексируется и никогда не содержит email, Platform или Telegram internal identifiers,
Telegram username, linking/evidence, security или audit data. Exact поля, avatar, discoverability
и visibility policy утверждены владельцем в Platform #51 и уточнены в Platform #189: Profile содержит
обязательное изменяемое non-unique display name и optional bio. Profile не является глобальным gate:
после первого sign-in Account без Profile может пользоваться доступными surfaces, а owner явно
создаёт и затем редактирует Profile в private Account. Profile открывается active members по opaque
URL без directory или search; self-service export/delete и participant reporting отсутствуют,
optimistic version защищает edit, а disabled state остаётся виден только owner. Owner-only release
operation может скрыть или восстановить точный Profile по opaque identity без публичной admin
surface. Avatar, любые image/file операции и S3 delivery вынесены в Platform #153 и не блокируют
text Profile vertical; это не расширяет brief до публичной социальной сети.

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

Редакционные оригиналы, черновики и связи материалов готовятся локально и сохраняются в Git
проекта Inside Content. Platform владеет опубликованным состоянием, доступом и показом материалов
читателю. Публикация создаёт или обновляет runtime-состояние и сама по себе не заменяет Git-оригинал.
Правки через editor/MCP относятся к состоянию Platform; их перенос обратно в оригиналы требует
явного редакционного согласования. Автоматическая двусторонняя синхронизация не реализована.
Контракт меток Серии описан в
[application specification](../specifications/platform-v1.md#series-step-sequences); автоматический
импорт остаётся отдельной работой #289.

Первая версия поддерживает:

- текст и структурированные гайды;
- видео через Kinescope;
- изображения;
- ссылки;
- прикреплённые и скачиваемые файлы.

У материала есть четыре независимые оси организации:

1. **Topic.** В domain model сущность называется `Topic`, в русском интерфейсе — «Тема». У
   материала ровно одна тема. В первой версии темы одноуровневые, без подтем.
2. **Format.** Формат хранится отдельно от темы: видео, текст, гайд и другие подтверждённые
   аудитом разновидности. У материала ровно один основной формат.
3. **Series.** Серия является упорядоченной последовательностью и в русском интерфейсе называется
   «Серия». Материал может входить в ноль или несколько серий и иметь отдельную позицию в каждой.
   Каждый явно включённый Material является следующим шагом согласно позиции: формат, дата и
   связи из тела не создают скрытые роли, автоматический skip или другой порядок.
   Автор может явно связать некоторые материалы именованной последовательностью шагов внутри
   серии. Под заголовком карточки видны название последовательности и «Шаг n из m»; между
   ними остаются видео, заметки и любые другие материалы. Все карточки имеют одинаковые тёмные
   номера общего порядка, соединённые пунктирной линией. Видео показывает опубликованное краткое
   описание под заголовком. Нумерация шагов учитывает только опубликованный состав.
   Формат не назначает последовательность автоматически; это не деление на основные и
   дополнительные материалы и не отдельная навигация Reader.
4. **Tag.** Теги выбираются из управляемого словаря, отображаются пользователю, открывают похожий
   контент и могут использоваться в фильтрах. У материала может быть ноль или несколько тегов;
   их можно добавлять, переименовывать и объединять без создания дублей и синонимов.

Конкретный список тем, форматов, тегов и поисковых фильтров определяется по результатам аудита
реального контента, а не проектируется заранее.

Прямое открытие Material остаётся самостоятельным. При входе из Series reader сохраняет выбранную
Series в `from` и показывает предыдущий/следующий опубликованный Material именно в её полном
авторском порядке; несуществующая Series или Series без текущего Material безопасно сбрасывает
контекст. Reader первой версии не выводит отдельный derived-блок связанных материалов. Community и обсуждения
остаются в Telegram, но отдельная ссылка на обсуждение для каждого материала не является
обязательной частью первой версии.

## Поиск и навигация

Платформа использует несколько представлений одной content model:

- **Главная** — public entry point `/` и bounded mobile-first витрина из текущих published данных:
  Серии первыми, компактное приглашение в Membership только для visitor/non-member, компактные
  Темы, затем новые Видео → Гайды → Заметки и переход в общий каталог. [Personal Home](../specifications/personal-home.md)
  добавляет реальное продолжение отдельным этапом; удаление invitation принадлежит #320;
- **База знаний** — единый real-data экран: один global search независимо сопоставляет Series по
  name/summary и Materials по public search projection; Series идут первыми и не зависят от
  material-only Topic/Format/sort/pagination. Публичный URL хранит `q`, `topic`, `format` и
  Material sort; cursor остаётся внутренним состоянием infinite query;
- **страница темы** — metadata направления, полный derived-список серий и paginated
  опубликованные материалы;
- **страница серии** — metadata, полный упорядоченный состав материалов и полный derived-список
  тем. Locked Material сохраняет своё место как safe teaser.

Owner выбрал верхнюю шапку A и словесный логотип C в
[#311](https://github.com/sachkov-inside/platform/issues/311); production integration —
[#313](https://github.com/sachkov-inside/platform/issues/313). Публичные страницы на desktop используют общую
верхнюю шапку с полным названием **Sachkov Inside**: Sachkov тёмный, Inside акцентный оранжевый,
без отдельного знака рядом с названием. Иконка вкладки — компактная `i` из выбранного варианта.

На desktop шапка содержит Главную, Базу знаний, переход «Найти материал» в каталог и кнопку
«Войти». После входа кнопка «Аккаунт» открывает Профиль и выход; недоступный статус сессии даёт
действие завершения сессии. Редактор в desktop-навигации виден только при `materials:manage`
и сохраняет свой отдельный рабочий экран.

Уточнение владельца для #313: **на mobile верхней шапки нет**. Сохраняется прежняя плавающая
нижняя навигация «Главная / База знаний / Профиль», с видимой подписью выбранного раздела.
Вход и действия аккаунта доступны через Профиль, поиск — в Базе знаний. Topic, Series и Reader
сохраняют выбранной Базу знаний. Нижняя панель учитывает safe area; содержимое и уведомления
не перекрываются ею. Reader закрепляет локальный возврат у верхней границы экрана.

На desktop шапка остаётся сверху, прокручивается содержимое; на mobile прокручивается страница,
нижняя навигация остаётся на месте. Левый сайдбар, повтор названия над страницей и строка якорей
Главной убраны. Карта остаётся доступной по прямому URL; будущие Roadmaps и Мастерская не
добавляются в навигацию до отдельного решения.

Roadmap является редакционной навигационной страницей, «Создание Platform Inside» — упорядоченной
Series, а База знаний — генерируемым представлением материалов, а не отдельной копией контента.

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

По решению владельца от 2026-09-06 [прогресс материалов](../specifications/reading-activity.md)
поставляется отдельной вертикалью: ручная отметка на Reader любого формата, единое состояние на
карточках и «Изучено N из M» по текущему опубликованному составу серии. Это личная отметка, не
оценка знаний. Проценты, achievements и gamification не входят.

[Персональная главная](../specifications/personal-home.md) отдельным этапом помогает любому
авторизованному Account продолжить незавершённое, включая free non-member. Она использует реальные
открытия и уже существующую позицию Video; точная позиция текста отложена. Account сохраняет свою
роль управления личными данными. [Аналитика автора](author-analytics-plan.md) планируется отдельно:
сначала определения посещений/просмотров, затем сбор и отчёт; подписки — будущее исследование
источника. Эти направления ещё не объявлены реализованными.

Новые материалы анонсируются через Telegram. Владелец со связанным Telegram и отдельным правом
`communications:manage` управляет заготовками, воронками и разовыми рассылками через Platform HTTP
и MCP. Право на материалы не выдаёт право на рассылки. Telegram хранит сообщения, сценарии и историю
доставки; Platform проверяет автора и предоставляет операции управления. Страница
`/authoring/communications/broadcasts` управляет разовыми рассылками и показывает контакты, источники, доставки
и переходы. Окончательное оформление согласуется отдельно; переход не доказывает прочтение или
оплату. Это не означает запуск на аудиторию: границы описаны в
[контракте интеграции](../integrations/communications-v1.md).

В `/authoring/communications` владелец создаёт стандартную и тематические воронки, настраивает
общее знакомство и упорядоченные части/шаги, добавляет заготовки по ID, именует источники и получает
ссылки запуска бота. Сохранение черновика отдельно от публикации. Предпросмотр показывает охват
и ошибки доступности бесплатных Materials/Series; история различает отправленную версию, ожидание,
ошибку и неизвестный результат. Повтор и пропуск — явные действия. Финальное визуальное принятие
этой функциональной поверхности ведёт [#316](https://github.com/sachkov-inside/platform/issues/316).
Внутренний notification center и email-рассылки остаются будущими возможностями.

## Публикация и agent-first contract

Платформа имеет собственную закрытую админку для создания и редактирования текущего состояния
Material: content, metadata, series membership, assets, access и publication state. Account с
`materials:manage` явно ведёт в эту админку. Там же author создаёт и редактирует Topic/Series,
архивирует их и атомарно сохраняет полный состав и порядок Series с optimistic conflict protection.

MCP является обязательной частью первой версии. Админка и MCP используют один application API и
одни domain rules; MCP не обращается к базе напрямую. Agent interface должен позволять:

- создать never-published draft из предоставленного текста или файла;
- читать и изменять материал;
- загружать и привязывать assets;
- назначать тему, формат, теги и Series;
- создавать, редактировать и архивировать Topic/Series и сохранять полный ordered Series состав;
- получать preview текущего сохранённого draft и состояние validation;
- одним full-state Save изменять content, metadata, `free | membership` и
  `draft | published | unpublished`.

MCP использует тот же Save; границу application permission и поручения агенту задаёт
[MCP contract](../specifications/platform-v1.md#mcp). Draft скрыт до первой публикации; после неё
каждый успешный Save немедленно меняет живой
Material и его Library/search projection. Platform не хранит старые bodies, restore history или
durable mutation journal; stale concurrent Save отклоняется по current content version.

Основное Kinescope Video можно просто убрать из Material: только успешный Save снимает reference,
а provider object остаётся нетронутым. Для загруженного самой Platform Video автор может отдельно
подтвердить «убрать и удалить»; durable запрос создаётся в той же Save transaction и выполняется
асинхронно только после проверки отсутствия current/published references. Привязанное по existing
Kinescope ID Video удалить через Platform нельзя. UI показывает requested/deleting/deleted/failed,
а восстановление или автоматическое удаление orphan Video не входят в продуктовый контракт.

## Создание актуальных материалов

Подготовка оригиналов и публикация следуют [границе контента](#контент). Текущий authoring
Save переносит подготовленный материал в Platform; автоматический импорт пока не реализован.
Telegram может служить исходным материалом для редакционной подготовки, но отдельного Telegram
migration pipeline в Platform нет.

После запуска:

- новый полный материал появляется на платформе;
- Telegram получает анонс, ссылку и обсуждение;
- платформа остаётся каноническим источником опубликованной версии.

## Граница MVP

В первую версию входят:

- публичная Главная с Сериями, общая База знаний, страницы тем и серий;
- публичные карточки закрытых материалов и полностью бесплатные материалы;
- полнотекстовый поиск и фильтры;
- вход по почте и через Telegram, private Account и связь с Telegram Membership;
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

Текущий фокус — самостоятельные Materials, связанные смешанные Series и подписка на опубликованный
контент. Отдельная Мастерская с Tracks, Laboratories и Production Cases отложена. Сохранённые
Workshop foundations и отдельный WorkshopEntitlement не означают, что этот продукт уже предлагается
участнику, и не превращают Series в Workshop Track.
[Отложенный контракт](../specifications/workshop-tracks.md) сохраняет принятые границы будущей работы;
её возобновление требует отдельной постановки задачи.

## Связанные application-документы

- [Platform v1 application specification](../specifications/platform-v1.md) владеет modules,
  logical schema, flows, application NFR, production foundation order и ADR inputs.
- [Workshop Tracks and Laboratories application specification](../specifications/workshop-tracks.md)
  сохраняет отложенные Track/Laboratory model, access, progress и Kafka slice.
- [Superseded case-first foundation](../specifications/production-workshop-v1.md) сохраняет ссылки
  на уже реализованные Workshop/Assignment/evaluator foundations без объявления их текущим
  product contract.
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
