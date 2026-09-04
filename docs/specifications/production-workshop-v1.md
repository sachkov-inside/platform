# Production Workshop v1 case-first foundation

Статус: **superseded** для product/application delivery документом
[Workshop Tracks and Laboratories](./workshop-tracks.md) и
[Platform #274](https://github.com/sachkov-inside/platform/issues/274).

Дата изменения статуса: 2026-09-04.

## Почему документ заменён

Первоначальная specification задавала один `Partner Webhooks` Case как весь первый Workshop
journey: отдельный beta grant, managed GitHub Assignment, локальный Go evaluator, exact source
archive и terminal `Passed`/`Needs work`.

Владелец подтвердил другую первую продуктовую границу в
[Workspace #108](https://github.com/sachkov-inside/workspace/issues/108): Workshop входит в
активную подписку, состоит из тематических Tracks и соединяет Materials, Laboratories и Production
Cases. Первый Track посвящён Kafka, а evaluation выбирается только после готового CaseSpec.

Поэтому этот файл больше не является authority для новых product, schema, API или UI решений.
История исходного контракта сохранена в Git и в
[Platform #258](https://github.com/sachkov-inside/platform/issues/258).

## Сохранённые foundations

Завершённые результаты могут быть переиспользованы после проверки против новой specification:

- [#263](https://github.com/sachkov-inside/platform/issues/263) — Workshop Module foundation,
  bounded WorkshopEntitlement и protected Case Materials;
- [#265](https://github.com/sachkov-inside/platform/issues/265) — versioned contracts и Go
  evaluator foundation;
- [#261](https://github.com/sachkov-inside/platform/issues/261) — C#/.NET и Python
  `Partner Webhooks` assets как historical content specimen.

Открытые delivery tickets прежнего vertical slice закрыты как `not planned`. Это не откатывает
смёрженный код и не объявляет его текущим Kafka solution.

## Текущий authority

- Shared product contract: Workspace
  [`production-workshop-v1.md`](https://github.com/sachkov-inside/workspace/blob/main/docs/specifications/production-workshop-v1.md).
- Platform application contract: [`workshop-tracks.md`](./workshop-tracks.md).
- Delivery graph: [Platform #274](https://github.com/sachkov-inside/platform/issues/274).
- Evaluation decision: [Platform #278](https://github.com/sachkov-inside/platform/issues/278),
  blocked by the Kafka CaseSpec.
