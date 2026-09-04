# Workshop Tracks domain specification

Статус: proposed repository-local contract для
[Platform #269](https://github.com/sachkov-inside/platform/issues/269). Он развивает текущую
терминологию proposed contract [Production Workshop v1](./production-workshop-v1.md), но не
расширяет первый
runtime slice из [#263](https://github.com/sachkov-inside/platform/issues/263).

## 1. Результат и граница

Workshop непосредственно содержит несколько тематических Workshop Tracks. Отдельный Program не
вводится, пока продукту не понадобится продаваемый bundle, cohort или edition поверх нескольких
Tracks.

Track объединяет Production Cases и learning resources в одной тематической
learning-practice области, например вокруг надёжной работы с RabbitMQ. Это curated learning
context, а не обязательно линейный курс, skill tree или access grant.

Значения терминов и их доменные отношения принадлежат
[Platform glossary](../../CONTEXT.md#production-workshop). Этот документ задаёт proposed
composition constraints, сценарии и открытые продуктовые решения. Persistence, API, routes, UI и
implementation tickets появляются только в отдельном owner-approved slice.

## 2. Composition constraints

В рамках glossary-модели Track authoring допускает следующую композицию:

```text
Workshop Track
├── Case Placement ───────────────────→ Production Case
└── Track Resource Group
    ├── optional preparation context ─→ Case Placement
    └── source
        ├── explicit Material references
        ├── Series reference
        └── Material Selector ─────────→ Topic / Tags / Format

CaseVersion
└── case-specific guidance ───────────→ CaseMaterial
```

- Между Workshop и Track нет дополнительного Program layer.
- Track composition может содержать Case Placements и Track Resource Groups без обязательного
  total order.
- Ассоциация Track Resource Group с Case Placement задаёт preparation/reference context; группа
  остаётся частью Track и не переходит во владение Case.
- Track Resource Group описывает, зачем ресурсы показаны: `core`, `recommended` или `reference`.
- Track references не копируют содержимое или taxonomy owning Materials Module и не меняют
  lifecycle Production Case или CaseMaterial.

## 3. Источники Track Resource Group

| Source | Семантика | Порядок | Подходящее применение |
|---|---|---|---|
| Explicit Materials | Автор явно выбирает ограниченный набор Materials. | Может быть задан внутри группы. | Core reading, точная подборка перед Case. |
| Series | Track ссылается на существующую ordered Series («Плейлист»). | Принадлежит Series. | Переиспользуемая последовательность Materials. |
| Material Selector | Live-выборка current published Materials по Topic, Tags, Format или их комбинации. | Не обещает curriculum order. | Related и recommended Materials. |

Dynamic Material Selector намеренно меняет результат, когда Material получает другую taxonomy,
публикуется или исчезает из доступной выборки. Поэтому selector нельзя использовать как строгий
prerequisite или как доказательство того, что learner прошёл фиксированный набор content.

Explicit Material и Series references отвечают за authored curation. Selector отвечает за
discovery. Эти source semantics остаются различимыми: dynamic result нельзя выдавать за explicit
зафиксированную подборку.

## 4. Порядок и progression

Track может иметь presentation order для Case Placements и Resource Groups. Explicit Materials
могут иметь reading order, а Series уже владеет своим порядком. Ни один из этих порядков сам по себе
не означает unlock condition.

Первый Track slice не выводит completion или Case eligibility из ReadingState, video progress,
позиции на странице либо наличия Material в selector. Формулировка «нужно изучить» означает
authored expectation, пока отдельное решение не определит проверяемое completion evidence.

Если продукту потребуется строгая последовательность, он добавит явную prerequisite/progression
policy. Она не выводится неявно из `ordinal`, UI layout или taxonomy.

## 5. Граница Track Resource Group и CaseMaterial

Track Resource Group отвечает на вопрос: «Что изучать в рамках этой тематической траектории или
рядом с этим Case?» CaseMaterial отвечает на вопрос: «Какой protected learning resource
принадлежит exact CaseVersion и когда его можно раскрыть?»

Поэтому:

- общая база RabbitMQ, reused Series и live related materials принадлежат Track Resource Groups;
- hint, exact solution, walkthrough и alternatives принадлежат CaseMaterial;
- prerequisite/reference остаётся CaseMaterial только когда смысл и release lifecycle ресурса
  действительно привязаны к exact CaseVersion;
- Track не использует CaseMaterial как скрытый способ построить всю curriculum structure.

## 6. Access consequence

Наличие Track, Case Placement или Track Resource Group не выдаёт доступ. WorkshopEntitlement и
ContentAccess остаются отдельными authority. Track composition сообщает, что показать learner;
ContentAccess решает, можно ли доставить body, asset или video конкретного Material.

Текущий scalar Material access class не решает автоматически, должен ли один и тот же Material
открываться альтернативно через Membership или Workshop. До отдельного owner decision:

- explicit Workshop-included resource не должен обещать delivery, которого не даёт его current
  access policy;
- dynamic selector может находить Material с собственной availability, но Track обязан честно
  представить locked/unavailable outcome;
- Track implementation не добавляет route-local Membership или Workshop fallback в обход
  ContentAccess.

## 7. RabbitMQ scenario

Track «RabbitMQ: надёжная доставка» может представить:

1. Core Track Resource Group со ссылкой на ordered Series «RabbitMQ: основы».
2. Case Placement «Надёжный consumer и retry», у которого свои Hint/Solution CaseMaterials.
3. Recommended Track Resource Group с live selector `Topic = RabbitMQ` и Tags `retries`, `DLQ`,
   `reliability`.
4. Case Placement «Transactional Outbox и доставка событий».
5. Reference Track Resource Group с несколькими explicit Materials без обязательного порядка.

Learner может начать с Case или открыть related Materials, если отдельная progression policy не
установлена. Изменение Tags обновляет только dynamic recommendation result; оно не меняет состав
explicit core group и не создаёт completion event.

## 8. Открытые решения до implementation

1. Один WorkshopEntitlement открывает весь Workshop или отдельные Tracks становятся самостоятельным
   entitlement target.
2. Может ли один Material открываться по правилу Membership **или** Workshop, и где живёт эта
   composition policy.
3. Должна ли published Track structure иметь immutable version и какие ссылки она фиксирует.
4. Series в Track читается как current composition или snapshot-ится при публикации Track.
5. Track ссылается на stable Production Case или на exact CaseVersion.
6. Нужны ли strict prerequisites; если да, какое observable evidence означает завершение Material.
7. Может ли Production Case входить в несколько Tracks и как learner progress переносится между
   placements.
8. Как Case Placements, Resource Groups и dynamic results представлены в первом responsive UI.

Эти решения не должны скрыто приниматься схемой данных или generic graph engine.

## 9. Не входит

- изменение first-case journey Production Workshop v1;
- schema, migrations, API, routes или UI;
- checkout, pricing, bundle, cohort, edition или Track-level purchase;
- universal curriculum graph, automatic completion и skill tree;
- изменение CaseMaterial reveal policy или ContentAccess delivery matrix из #263.

## 10. Условия готовности implementation slice

Implementation начинается только когда выбран первый user-visible Track scenario и закрыты
применимые решения из раздела 8. Его issue отдельно определяет observable outcome, access boundary,
versioning, negative cases и UI evidence; эта proposed specification сама по себе не утверждает,
что Track уже существует в runtime.
