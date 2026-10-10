# Спецификация Inside Workshop v1

> Историческая общая спецификация Workspace. Исходный статус ниже описывает прежний этап.
> Новые решения принимаются по [локальному контракту](../../../specifications/workshop-tracks.md)
> и [текущему brief](../../../product/platform-mvp-brief.md).
> Источник: [исходный commit](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/specifications/production-workshop-v1.md).

Статус: accepted shared specification для human outcome
[#97](https://github.com/sachkov-inside/workspace/issues/97), обновлённая подтверждёнными owner
decisions из [#108](https://github.com/sachkov-inside/workspace/issues/108).

Дата последнего изменения: 2026-09-04.

Эта редакция заменяет первоначальный case-first срез с `Partner Webhooks`. Она сохраняет уже
созданные технические foundations, если они не противоречат новой продуктовой модели, но не
обязывает использовать прежний evaluator или managed Assignment flow.

## Текущий статус направления

Отдельная Мастерская и Kafka-first delivery отложены решением владельца 2026-09-05 в
[плане #111](https://github.com/sachkov-inside/workspace/issues/111). Этот accepted контракт
сохраняет границы практики и её foundations, но не задаёт ближайший план наполнения Platform.
Для текущих материалов и серий читать [действующий brief](../../../product/content-series-authoring-brief.md).
Workshop Track и Series остаются разными понятиями.

## 1. Результат и authority

Inside Workshop, далее **Workshop** или «Мастерская», становится практической частью Inside для
разработчиков, которые уже умеют программировать и хотят изучать современные технологии через
наблюдение, проектирование и реализацию работающих систем.

Workshop не заменяет Библиотеку и не превращается в один большой линейный курс. Он собирает
Материалы, Лаборатории и Production Cases в тематические Tracks. Автор предлагает порядок, но
участник может открыть доступный элемент трека раньше и выбрать нужную ему глубину практики.

Этот документ фиксирует общий продуктовый контракт и cross-repository границы:

- Workspace владеет общей моделью продукта и терминологией;
- Platform владеет доступом, публикацией, прогрессом и пользовательским интерфейсом;
- `sachkov-inside/workshop-cases` хранит versioned authoring source для Tracks, Laboratories,
  Production Cases и stack-specific artifacts;
- опубликованные Materials принадлежат Platform runtime; новые редакционные оригиналы готовятся
  в Inside Content, а редактор Platform/API/MCP обслуживает публикационное состояние;
- конкретная проверка Production Case определяется после проектирования первого Kafka-кейса.

## 2. Проблема и обещание

Документация и coding agent позволяют быстро получить рабочий код, но сами по себе не формируют
надёжную модель системы. Разработчику всё ещё нужно:

1. понять, как технология ведёт себя в нормальном режиме и при сбоях;
2. решить, нужна ли она в конкретном бизнес-контексте;
3. сформулировать ограничения, invariants и компромиссы;
4. спроектировать изменение и разделить работу на проверяемые шаги;
5. использовать агента как инструмент, сохраняя ответственность за решение;
6. собрать evidence, объяснить фактическое поведение и скорректировать гипотезу.

Workshop тренирует этот цикл. Он не обещает grade, трудоустройство, персональное менторство,
независимую сертификацию или обучение программированию с нуля.

## 3. Продуктовая и коммерческая граница

В первой версии `Inside Subscription` является одним коммерческим bundle. Пока она активна,
Platform поддерживает два самостоятельных права:

- Библиотеку через `AccountRights`;
- Мастерскую через `WorkshopEntitlement`.

Раздельные права нужны не ради двух текущих тарифов, а чтобы позднее можно было отдельно
спроектировать Workshop-only offer. Пока действует подписка, действуют оба права; прекращение
подписки завершает оба связанных доступа после их обычного bounded validity. Будущий отдельный
Workshop access потребует явного `ContentAccess`-решения для включённых Membership Materials и не
считается уже поддержанным этой моделью.

Первая версия `WorkshopEntitlement` открывает весь опубликованный Workshop. Покупка отдельного
Track, cohort, edition, временный bootcamp и пожизненный доступ не входят в текущую модель.

Публичные Workshop Resources не требуют entitlement. Доступность Laboratory и Production Case
решает `WorkshopAccess`; доступность Material решает `ContentAccess`. Track Item только показывает
canonical policy target.

## 4. Учебная модель

```text
Workshop
└── 1..N Workshop Tracks
    └── 1..N ordered Track Items
        ├── Material reference ─────────→ Platform Material
        ├── Laboratory ─────────────────→ productd local experiments
        └── Production Case ────────────→ design + implementation problem
```

### 4.1 Workshop Track

**Workshop Track** — авторская тематическая траектория вокруг технологии или инженерной
способности. Первый Track посвящён Kafka.

Track содержит:

- цель и ожидаемый практический результат;
- prerequisites и примерную сложность;
- рекомендуемый порядок элементов;
- явную доступность каждого элемента;
- ожидаемое время только как ориентир, без обещания одинакового темпа;
- published lifecycle, чтобы черновая структура не появлялась у участника.

Порядок помогает выбрать следующий шаг, но не является unlock rule. В первой версии нет строгих
prerequisites, универсального curriculum graph, XP, grade или автоматического доказательства
знаний.

### 4.2 Track Item

**Track Item** — одно место в рекомендуемом порядке Track, которое ссылается ровно на один
Material, Laboratory или Production Case. Элемент задаёт:

- ordinal внутри Track;
- краткое объяснение, зачем он расположен здесь;
- presentation metadata, включая authored rationale;
- отображение canonical availability referenced target;
- optional relation к другим элементам только для навигации, не для скрытой блокировки.

Один Material, Laboratory или Production Case может быть переиспользован в нескольких Tracks без
копирования содержимого.

### 4.3 Materials

Material объясняет понятие, решение или наблюдение. Его canonical body и publication lifecycle
принадлежат Platform. Автор или coding agent создаёт Material через Platform editor либо MCP.

Track хранит ссылку на опубликованный Material и не копирует его body в Workshop authoring
repository. Динамические подборки по Topic и Tags могут дополнять Track как рекомендации, но не
заменяют явный authored порядок и не становятся prerequisite.

### 4.4 Laboratories

**Laboratory** — самостоятельная пошаговая практика, в которой участник локально собирает
окружение, изменяет его и наблюдает реальное поведение технологии. Это отдельная сущность, а не
формат Material и не упрощённый Production Case.

Лаборатория задаёт цель, prerequisites, ожидаемое окружение и упорядоченные шаги. Типичный шаг
ведёт через мягкий экспериментальный цикл:

1. сформулировать предположение о поведении системы;
2. выполнить команду или изменить configuration/code;
3. наблюдать logs, metrics, UI или output клиента;
4. сравнить результат с предположением и сохранить короткий вывод.

Поля предположения, наблюдения и вывода помогают думать и сохранять заметки, но не блокируют
следующий шаг. Участник сам отмечает шаги выполненными; Platform сохраняет прогресс и не выдаёт
ручную отметку за подтверждённое mastery.

В первой версии:

- лаборатория выполняется на компьютере участника;
- готовая облачная sandbox-среда не предоставляется;
- участник сам создаёт Docker Compose и необходимые файлы по product;
- команды и checkpoints могут быть приведены прямо в шагах;
- prompts показывают, как использовать агента для исследования и проверки, не делегируя ему
  решение целиком;
- сохранённый manual progress можно продолжить после возвращения.

### 4.5 Production Cases

**Production Case** — правдоподобная бизнес-задача, в которой участник сначала проектирует
изменение, затем реализует и проверяет его на поддерживаемом стеке. Условие описывает цель,
контекст, ограничения и observable requirements, но не разжёвывает техническое решение.

Case может иметь несколько **Case Variants**. Варианты сохраняют общий learning outcome и
business contract, но используют разные starter code, libraries и idiomatic implementation.

Первый Kafka-кейс получает варианты C#/.NET и Python. Их parity подтверждается общим behavioural
contract и отдельной проверкой ecosystem-specific поведения. Автоматический port, который никто
не запускал, не считается поддержанным вариантом.

Механизм submission и evaluation намеренно не определён этой редакцией. Старые `Assignment`,
`Attempt`, source archive и Go evaluator являются доступными foundations, а не обязательным
решением. Сначала фиксируются case contract и ожидаемые решения, затем отдельная задача сравнивает
локальную проверку, GitHub-based flow и возможную новую модель evidence.

### 4.6 Projects

Длинные проекты, в которых участник последовательно строит целый сервис, остаются следующим
уровнем Workshop. Они не входят в первый Kafka-срез и не требуют отдельной верхнеуровневой секции
Platform сейчас.

## 5. Публичная витрина и доступность

Публичный посетитель видит страницу Workshop и полный план опубликованного Track: цель,
prerequisites, ожидаемые навыки и карточки всех элементов. Закрытая карточка честно показывает,
что входит в подписку, но не раскрывает protected body или artifacts.

Любой Material, Laboratory или Production Case можно опубликовать бесплатно через его owning
access authority. Это не специальное правило «первого урока» и не отдельный тариф. Track Item
отображает canonical availability своей цели, поэтому один переиспользуемый resource не бывает
одновременно public и protected в разных Tracks. Free resource:

- заметно отмечен в Track и на собственной странице;
- открывается без Account или WorkshopEntitlement, если его собственная security boundary это
  допускает;
- использует тот же published content, а не урезанную копию;
- может предлагать вход или подписку для сохранения прогресса и продолжения Track.

Для первого Kafka Track публичен план и первая Laboratory. Остальные Materials и Production Case
доступны активному подписчику.

## 6. Authoring и публикация

Tracks, Laboratories и Production Cases создаются как versioned structured content в private
`sachkov-inside/workshop-cases`. Несмотря на историческое имя repository, в первой версии он
является authoring source всего Workshop practice content.

Platform импортирует exact source commit, валидирует references и публикует immutable snapshot.
Новая смысловая редакция опубликованной сущности создаёт новую version; существующий progress и
будущий evaluation evidence продолжают ссылаться на прежнюю version.

Workshop source может ссылаться только на stable identifiers опубликованных Materials. Material
body не дублируется в Git. Отсутствующая, unpublished или конфликтующая с expected availability
ссылка делает publication fail-closed.

Universal visual builder и двусторонняя синхронизация Git ↔ Platform не входят в первый срез.

## 7. Первый Kafka Track

### 7.1 Учебный результат

После Track участник должен:

- объяснить роль broker, topic, partition, offset и consumer group;
- предсказать распределение сообщений и поведение consumers при rebalance;
- воспроизвести повторное чтение, backlog и типичные failure modes;
- отличить транспортную доставку от успешной бизнес-обработки;
- решить, где Kafka уместна в сценарии, и назвать стоимость выбранной архитектуры;
- спроектировать и реализовать асинхронную функцию, учитывая duplicates, retries,
  idempotency, ordering, schema evolution и observability;
- объяснить, что сделал coding agent и каким evidence участник проверил результат.

### 7.2 Состав первой версии

Первая версия Track содержит небольшой authored набор Materials, одну составную Laboratory и один
Production Case. Точные Material IDs добавляются по мере публикации контента и не блокируют
проектирование практики.

Laboratory «Kafka: от запуска до сбоев» проводит участника через:

1. самостоятельную сборку и запуск минимального Docker Compose окружения;
2. создание topic и наблюдение partition assignment;
3. отправку и чтение сообщений;
4. изменение размера consumer group и наблюдение rebalance;
5. работу с offsets, остановку consumer и накопление backlog;
6. повторный запуск и replay;
7. намеренный сбой обработки и разбор того, что Kafka гарантирует, а что должен обеспечить
   application code.

Replication, broker cluster failure, production capacity planning и глубокий tuning остаются за
границей первой Laboratory.

### 7.3 Kafka Production Case: надёжная рассылка уведомлений

Участник получает бизнес-требование вынести отправку уведомлений из синхронного потока приложения
и поддержать несколько каналов без замедления основной операции. В контексте присутствуют сбои
провайдера, повторная доставка сообщения, необходимость повторной обработки и эксплуатационная
диагностика.

Участник должен:

1. описать границы сервисов и обосновать, где Kafka нужна либо не нужна;
2. выбрать events/topics, key и consumer topology;
3. определить semantics успешной обработки, retries, poison message и terminal failure;
4. защитить бизнес-эффект от duplicates и учесть требуемый порядок;
5. описать compatibility событий и минимальную observability;
6. реализовать выбранную функцию в C#/.NET или Python;
7. предоставить functional и operational evidence.

Case не навязывает единственную topology. Author solution обязано объяснить допустимые
альтернативы и причины, по которым решение удовлетворяет либо нарушает business invariants.

Точные fictional domain, API, нагрузочные ограничения, starter baseline и pass policy определяет
отдельная content-design задача до изменения evaluator.

## 8. System boundaries

| Область | Authority |
|---|---|
| Materials body, taxonomy и publication | Platform Materials Module |
| Membership и Workshop grants | Platform access Modules |
| Track/Laboratory/Case source | `sachkov-inside/workshop-cases` exact Git commit |
| Published Workshop snapshots и progress | Platform Workshop Module |
| Material delivery | Platform ContentAccess |
| Workshop outline/Laboratory/Case delivery | Platform WorkshopAccess |
| Community и announcements | Telegram application |
| Case submission/evaluation | Deferred до отдельного решения после Kafka CaseSpec |

ContentAccess и WorkshopAccess остаются server-side. Track navigation не является authority и не
может раскрыть protected body через route, API, asset URL или cached response.

## 9. Delivery sequence

Работа развивается поэтапно:

1. согласовать shared product contract и repository-local model;
2. спроектировать Kafka Track, Laboratory и notification Production Case;
3. на готовом CaseSpec выбрать submission/evaluation boundary;
4. реализовать versioned Workshop authoring/import, publication и backend ручного Laboratory progress;
5. связать активную подписку с AccountRights и WorkshopEntitlement;
6. после завершения текущего visual foundation выбрать интерфейс Track/Laboratory;
7. подготовить C#/.NET и Python variants, backend operations и выбранную evaluation model;
8. реализовать полноценный frontend Workshop, Track, Laboratory и Production Case на реальных API;
9. провести end-to-end acceptance всего learner journey.

Каждый этап имеет отдельную repository-owned задачу. Завершённые foundations прежнего
Partner Webhooks slice могут переиспользоваться только после проверки их соответствия новому
контракту.

## 10. Не входит и открытые решения

В первый Kafka-срез не входят:

- hosted Kafka environment или выполнение participant code внутри Platform;
- длинный Project Track и portfolio/certificate;
- strict progression, cohort, deadlines, mentor review или guaranteed feedback;
- отдельная продажа Kafka, Track-level checkout и несколько уровней подписки;
- глубокая Kafka operations laboratory;
- AI-generated grade либо оценка того, насколько самостоятельно человек писал код.

Отдельный Workshop-only offer и правило доступа к связанным Membership Materials проектируются
вместе, если появляется реальная задача продавать или выдавать Workshop без подписки. До этого
такой доступ не обещается.

Имя `workshop-cases` исторически уже не отражает его новую роль. Возможное переименование в
`workshop-content` оценивается после первого Track/Laboratory source, когда можно измерить цену
миграции repository links и integrations; оно не блокирует первый Kafka-срез.

После готовности Kafka CaseSpec нужно отдельно решить:

1. что считается сдачей design artifact и implementation;
2. какие проверки выполняются локально, а каким evidence доверяет Platform;
3. нужен ли managed GitHub Assignment либо достаточно другого source handoff;
4. остаётся ли `Passed` корректным result language;
5. какие части существующего Go evaluator и versioned contracts переиспользуются.

Эти вопросы не должны скрыто решаться persistence schema или UI prototype.

## 11. Acceptance первого продуктового среза

Первый Kafka-срез считается собранным, когда:

- публичный посетитель видит понятный план Track и может открыть бесплатную Laboratory;
- активный подписчик получает доступ ко всем опубликованным элементам через две корректные
  entitlement boundaries;
- Laboratory можно пройти локально, сохранить ручной progress и вернуться к нему;
- Track связывает Materials без копирования их body;
- Production Case публикует единый business contract и честно поддержанные C#/.NET и Python
  variants;
- выбранный после CaseSpec submission/evaluation flow проверен отдельно и не выдаёт local run за
  независимое доказательство;
- mobile и desktop UI показывают рекомендуемый путь, тип, доступность и состояние каждого
  элемента без ложной обязательной последовательности.

Финальный merge каждой implementation-задачи, production credentials/actions и изменение
commercial terms требуют отдельных owner gates по repository workflow.
