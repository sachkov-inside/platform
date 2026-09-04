# Workshop Tracks and Laboratories application specification

Статус: accepted repository-local contract для
[Platform #275](https://github.com/sachkov-inside/platform/issues/275) и первого Kafka Track из
[#274](https://github.com/sachkov-inside/platform/issues/274). Он реализует подтверждённую shared
границу [Workspace #108](https://github.com/sachkov-inside/workspace/issues/108).

Дата: 2026-09-04.

## 1. Результат и authority

Platform представляет Workshop как практическую область активной подписки Inside. В ней
опубликованные Workshop Tracks соединяют Materials, Laboratories и Production Cases в
рекомендуемом порядке без обязательного линейного unlock.

Этот документ владеет Platform-specific model, authoring/publication boundary, access semantics,
learner progress и requirements первого Kafka-среза. Shared product promise и cross-repository
термины принадлежат Workspace. Physical schema, API shapes и component composition появляются в
implementation tickets #279–#282 и не угадываются здесь заранее.

Прежняя [case-first application specification](./production-workshop-v1.md) больше не является
текущим продуктовым контрактом. Уже реализованные foundations остаются доступными, но их повторное
использование требует явного соответствия этой specification.

## 2. Product boundary

### Входит

- Workshop с несколькими тематическими Tracks без дополнительного Program layer;
- один active `WorkshopEntitlement`, открывающий весь protected Workshop;
- public metadata и полный план опубликованного Track;
- `TrackItem` со ссылкой на Material, Laboratory либо Production Case;
- target-owned access: `free | membership` для Materials и `public | workshop` для Laboratories и
  Production Cases;
- versioned Git authoring для Track, Laboratory и Production Case;
- ссылки на canonical Platform Materials без копирования body;
- manual Laboratory progress и optional learner notes;
- первый Kafka Track с одной публичной Laboratory и одним Production Case;
- будущие C#/.NET и Python variants одного Kafka Case contract.

### Не входит

- отдельный commercial SKU, checkout или Track-level purchase;
- strict prerequisites, grade, XP, certificate или generic curriculum graph;
- hosted Kafka sandbox или выполнение participant code в Platform;
- длинные Projects;
- окончательная Assignment, submission, Attempt и evaluator model;
- universal visual authoring builder и двусторонняя Git synchronization.

## 3. Application model

```text
Workshop
└── WorkshopTrack 1..N
    └── TrackItem 1..N (ordered)
        ├── Material target ───────────────→ Materials Module
        ├── Laboratory target ─────────────→ LaboratoryVersion
        └── Production Case target ────────→ ProductionCaseVersion

Laboratory
└── LaboratoryVersion 0..N
    └── LaboratoryStep 1..N (ordered)

Account
└── LaboratoryProgress 0..N
    └── LaboratoryStepProgress 0..N
```

### 3.1 WorkshopTrack

`WorkshopTrack` имеет stable identity, title, summary, learning outcomes, prerequisites,
indicative difficulty/duration и 1..N authored `TrackItem`. Published Track имеет ровно одну
current immutable version; новая смысловая редакция создаёт следующую version.

Lifecycle: `draft → published → retired`.

- `draft` не виден learner reads;
- `published` имеет public outline и может открывать targets по их access policy;
- `retired` не появляется в discovery, но сохраняет historical references и progress.

Track может быть переиспользован будущим bundle/edition, но эти entities сейчас не вводятся.

### 3.2 TrackItem

`TrackItem` принадлежит exact Track version и содержит:

- stable item identity внутри Track;
- positive unique ordinal;
- ровно один typed target: Material, Laboratory либо Production Case;
- короткое authored rationale «зачем этот элемент здесь»;
- optional presentation metadata;
- read-model projection `public | included` из canonical policy typed target.

Authoring source называет stable target identity. При публикации Track snapshot сохраняет stable
Material identity, но фиксирует exact current published LaboratoryVersion или
ProductionCaseVersion. Новая Laboratory/Case version не меняет существующий Track snapshot:
автор публикует новую Track version, если хочет включить обновление. Material остаётся mutable
Platform content и читается по своей current published revision согласно Materials contract.

Ordinal задаёт только presentation order. Отсутствие completion предыдущего item не блокирует
прямой переход. UI не может выводить access или completion из соседства карточек. TrackItem не
переопределяет access: один target имеет одинаковую доступность во всех Tracks.

Один target может встречаться в нескольких Tracks. TrackItem не копирует target content и не
меняет его lifecycle.

### 3.3 Material target

Materials Module остаётся единственным source of truth для Material body, taxonomy, revision и
publication. Автор либо agent создаёт Material через admin/MCP Save flow.

Track authoring хранит stable Material identity. Publication разрешает ссылку только на
существующий Published Material:

- `free` Material отображается как public/free TrackItem;
- `membership` Material отображается как included TrackItem и требует allow от `ContentAccess`;
- legacy `workshop` CaseMaterial из #263 не становится обычным Track Material target до отдельного
  reuse decision;
- несовместимая access policy делает Track publication fail-closed;
- dynamic Topic/Tag recommendations могут отображаться отдельно, но не становятся TrackItems или
  prerequisites.

### 3.4 Laboratory и version

`Laboratory` имеет stable identity и 0..N immutable versions. Published/startable Laboratory имеет
ровно одну current published version. Смысловое изменение цели, required environment или шага
создаёт новую version.

`LaboratoryVersion` содержит:

- цель, prerequisites, supported environment и expected time range;
- safety/setup/cleanup guidance;
- ordered steps;
- bounded troubleshooting и agent prompts;
- optional completion summary;
- source commit и publication provenance.

Stable Laboratory также объявляет canonical access mode `public` или `workshop`. Изменение access
policy применяется ко всем TrackItems, которые на неё ссылаются, и проходит отдельную validation;
Track composition не хранит override.

Lifecycle version: `draft → published → withdrawn`. Withdrawn version нельзя начать заново, но
existing Account progress остаётся читаемым.

### 3.5 LaboratoryStep

`LaboratoryStep` принадлежит exact LaboratoryVersion. Он содержит цель, action guidance и
observable checkpoint. Optional поля `predictionPrompt`, `observationPrompt` и
`conclusionPrompt` поддерживают цикл «предположил → запустил → наблюдал → сделал вывод», но ни одно
из них не является required gate.

Step может содержать commands/config snippets, но guide должен объяснять назначение существенных
частей. Простое копирование непрозрачного готового environment не удовлетворяет first-lab
contract.

### 3.6 LaboratoryProgress

`LaboratoryProgress` принадлежит одному Account и exact LaboratoryVersion. Он является private
resume state, а не evaluation evidence.

- Account вручную отмечает шаг complete/incomplete;
- optional prediction, observation и conclusion notes сохраняются отдельно per step;
- повторная запись одного состояния idempotent;
- completion всей Laboratory означает только manual completion всех steps;
- новая LaboratoryVersion не переносит progress автоматически;
- anonymous visitor проходит public Laboratory без durable progress; sign-in CTA честно объясняет
  это до потери данных.

Notes имеют bounded length, не исполняются и не попадают в public Track. Их retention/deletion
следует общему Account data lifecycle.

### 3.7 ProductionCase и CaseVariant

Production Case задаёт versioned business context, constraints, expected design artifact,
observable implementation requirements, author analysis и canonical access mode `public` либо
`workshop`. Он не обязан иметь executable checks до отдельного evaluation decision.

Case Variant сохраняет общий business/learning contract, но владеет stack-specific starter,
toolchain и idiomatic author solution. Первый Kafka Case планирует C#/.NET и Python. Ни один variant
не считается supported без real ecosystem smoke и common behavioural review.

Case-specific hint, solution и alternatives остаются Case resources; общие Kafka Materials
принадлежат Materials Module и включаются в Track отдельными TrackItems.

## 4. Authoring and publication

Private `sachkov-inside/workshop-cases` является Git authoring source для `TrackSpec`,
`LaboratorySpec`, `CaseSpec` и stack artifacts. Историческое имя repository не ограничивает его
только Cases.

Owner release operation принимает exact commit и выполняет:

1. parse versioned schemas;
2. validate stable identities, lifecycle и supported schema versions;
3. resolve internal Track/Laboratory/Case references;
4. verify referenced Materials через Materials Module;
5. verify canonical target availability and requested presentation expectations;
6. persist immutable source snapshot/provenance;
7. atomically move all requested current pointers либо fail without partial publish.

Повторная публикация того же exact source commit idempotent. Наличие валидного source не выдаёт
access и не делает draft публичным.

## 5. Access

`ContentAccess` remains the sole delivery authority for Materials. `WorkshopAccess` owns Track
outline, Laboratory and Production Case delivery. A Track read composes their typed decisions into
the presentation vocabulary `public | included | unavailable`, but does not invent a third
route-level fallback.

Одна active Inside subscription поддерживает две отдельные Platform authorities:

- `MembershipEntitlement` для Library/Materials;
- `WorkshopEntitlement` для protected Workshop content.

Одно accepted `MembershipEvidence` создаёт, продлевает и завершает оба bounded grants через их
owning modules. Platform не вводит subscription/billing entity и не вычисляет один grant
route-local проверкой другого. Такой contract сохраняет возможность будущего отдельного Workshop
grant, не создавая отдельный текущий продукт.

Будущий Workshop-only offer требует отдельного `ContentAccess`-решения для закрытых Materials,
которые включены в Track. До такого решения один WorkshopEntitlement не обещает доступ к
Membership Materials вне текущего subscription bundle.

Workshop access matrix:

| Subject | Track outline | Public target | Protected Workshop target | Durable lab progress |
|---|---:|---:|---:|---:|
| Anonymous | allow | allow | deny | deny |
| Account без WorkshopEntitlement | allow | allow | deny | allow только после sign-in для public Laboratory |
| Account с active WorkshopEntitlement | allow | allow | allow | allow |
| Account с expired WorkshopEntitlement | allow | allow | deny | historical state readable, protected body deny |

Material delivery дополнительно требует allow от `ContentAccess`; Workshop composition не может
ослабить его решение. Laboratory/Case pages, APIs, downloads и assets используют canonical access
mode owning target и не доверяют UI lock state.

## 6. Presentation contract

Public Workshop page показывает published Tracks. Track page показывает цель, prerequisites,
learning outcomes и полный ordered outline.

Каждый item различимо показывает:

- тип: Material, Laboratory или Production Case;
- public/free либо included in the current subscription;
- recommended current/next presentation;
- manual Laboratory state, если он существует;
- unavailable/withdrawn состояние без исчезновения объяснения.

Public target использует единый reusable visual marker во всех его TrackItems. Закрытая карточка
не имитирует бесплатный preview body. Recommended order не изображается как технически locked
progression.

Первая composition выбирается в prototype #273 после завершения visual foundation #271 / PR #272.
Production pages поставляет #281.

## 7. First Kafka Track specimen

Первый Track должен выдержать настоящие данные из #276 и #277:

1. authored Kafka learning outcome и prerequisites;
2. explicit Material references, добавляемые по мере публикации Materials;
3. public Laboratory «Kafka: от запуска до сбоев»;
4. protected Production Case «Надёжная рассылка уведомлений»;
5. optional dynamic related Materials вне ordered TrackItems.

Laboratory покрывает самостоятельный Docker Compose, topic/partitions, producer/consumer,
consumer groups, rebalance, offsets, backlog, replay и application-level failure. Replicated
cluster operations, tuning и capacity planning не входят.

Production Case требует спроектировать и реализовать асинхронную notification feature с provider
failures, duplicates, retries, poison messages, ordering, compatibility и observability. Exact
fictional domain и constraints принадлежат #277.

## 8. Deferred evaluation boundary

`Assignment`, `Attempt`, `AttemptResult`, source archive и Go evaluator существуют как foundations
прежнего case-first slice. Они не являются автоматическим contract первого Kafka Case.

После accepted CaseSpec #277 задача #278 должна определить:

- форму design artifact и границу qualitative judgement;
- observable behavioural scenarios;
- source/evidence identity и trust;
- local, GitHub-based или иной handoff;
- failure, retry и result language;
- точный reuse либо retirement существующих foundations.

До этого решения schema Track/Laboratory не получает фиктивный universal submission abstraction.

## 9. Negative cases

- Duplicate/non-positive ordinal, missing target или несколько targets отклоняют Track source.
- Missing/unpublished Material, Laboratory или Case отклоняет atomic publication.
- TrackItem не повышает protected target до public и не понижает public target до protected.
- Anonymous progress mutation отклоняется без создания скрытого Account state.
- Manual complete не создаёт AttemptResult и не называется mastery.
- Retired Track/withdrawn Laboratory не открывают новые starts, но не удаляют historical state.
- Expired WorkshopEntitlement не раскрывает protected body через direct API, asset или cached
  response.
- Unknown source/schema version fail closed.

## 10. Delivery graph

| Issue | Role | Opens |
|---|---|---|
| #275 | This accepted application contract | #279, #280 and revised #273 |
| #276 | Real Kafka Track/Laboratory content specimen | #279 and #273 |
| #277 | Real notification CaseSpec | #278, #279 and #282 |
| #278 | Evaluation research and owner decision | refined #282 |
| #279 | Versioned import/publication/read model and Laboratory progress backend | #282 and #281 |
| #280 | Subscription grants and public access | #281 |
| #273 | Visual prototype after #271/#272 | #281 |
| #282 | C#/Python variants, evaluation backend and typed states | #281 |
| #281 | Full Workshop/Track/Laboratory/Case frontend on real APIs | #283 |
| #283 | Aggregate end-to-end acceptance | parent #274 completion |

## 11. Acceptance and stopping condition

Эта specification готова, когда repository glossary и product brief используют тот же язык,
conflicting case-first document явно superseded, `pnpm docs:check` проходит, а implementation graph
содержит owner-approved dependencies.

Issue #275 не меняет runtime. Первый product slice завершён только aggregate acceptance #283.
