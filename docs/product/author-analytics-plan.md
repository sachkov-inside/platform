# Аналитика автора: посещения, материалы и будущие подписки

Статус: владелец 2026-09-06 поручил отдельные задачи. Направление подтверждено; точные определения
измерений, сроки хранения и способ anonymous identity требуют отдельного решения до implementation.
Delivery: [Specification #325](https://github.com/sachkov-inside/platform/issues/325).

## Что должен узнать автор

Сколько посетителей приходит на платформу, какие материалы открывают и как меняется интерес во
времени. Отчёт должен объяснять, что именно посчитано и где точность ограничена. Это отдельная
поверхность authoring; новый permission согласуется в measurement contract, не выводится
автоматически из Membership, materials:manage или communications:manage.

[Telegram #317](https://github.com/sachkov-inside/platform/issues/317) уже владеет оформлением
отправок и переходов рассылок. Его не переделывать и не называть click просмотром материала.
Platform общается с владельцами фактов через interfaces; не читает их schemas напрямую.

## Словарь будущих показателей

Этот словарь остаётся действующим до принятия
[контракта измерений v1](../specifications/author-analytics-measurement-v1.md). После принятия точные
определения показателей, их пределы точности и правила счёта живут в контракте, а этот раздел
остаётся кратким продуктовым описанием и на них ссылается.

| Показатель | Что обязан различать контракт |
|---|---|
| Посещение Platform | Начало определённой сессии; session boundary ещё предстоит выбрать |
| Уникальный посетитель | Приближение браузера, а не человек; точное определение — в контракте измерений |
| Просмотр материала | Видимый Reader после получения разрешённого body; не teaser, prefetch или download |
| Изучение материала | Ручной ReadingState transition; не playback и не проверка знаний |
| Переход из Telegram | Отдельное событие communications; attribution не доказывает изучение/покупку |
| Подписка/продление | Подтверждённый lifecycle факт выбранного источника; отсутствует в первом отчёте |

Граница сессии, повторные views/reload, foreground/visible criteria, anonymous storage/consent,
таймзона отчёта, bots/automation, retention/deletion, attribution allowlist и поздние события
должны быть выбраны до начала сбора. Не сохранять полные referrer/query с tokens/PII. При отказе
или блокировке tracking продукт остаётся работоспособным; отчёт честно отражает неполное покрытие.
Уникальных посетителей нельзя суммировать по дням или материалам для общего unique total.

## Отдельные этапы

1. **Контракт измерений.** Проверить имеющиеся источники, показать owner определения с примерами,
   privacy/storage choices, пример отчёта и ограничения; выбрать минимальную реализацию и
   оценить объём. PostgreSQL рассматривается первым в существующей архитектуре, без покупки
   внешнего сервиса или speculative analytics cluster. Итог — принятый versioned contract,
   уточнённые schemas и promoted readiness зависимых implementation tickets.
   Предложенная редакция — [контракт измерений v1](../specifications/author-analytics-measurement-v1.md);
   она ждёт решения владельца и до него не меняет readiness зависимых задач.
2. **Сбор посещений и просмотров.** Owned validated ingestion, event IDs/dedupe, bounded input,
   time semantics, доступ к body, bots/consent, retention/deletion. Это enabling capability;
   само по себе не поставляет интерфейс автора. Включение production tracking — отдельный GO.
3. **Визуальный proof отчёта.** Период и timezone, totals, таблица материалов, доступ, empty,
   no-data-before-rollout, partial/delayed/unavailable. Owner принимает desktop/mobile states.
4. **Работающий отчёт.** Подключить сбор/агрегации и proof, ограничить server permission, сверить
   результаты с фиксированным набором событий, проверить производительность bounded queries,
   получить production visual GO. Это завершает #325; revenue/subscriptions не блокируют его.

ReadingActivity хранит state и transactional transition history с самого начала, поэтому будущий
отчёт сможет считать первые ручные отметки после внедрения. Для внешнего consumer delivery нужен
отдельный надёжный протокол с outbox/ack/retry/dedupe, вводимый вместе с первым потребителем.
Material visits персональной Home — recency state, не журнал всех посещений и не замена analytics.
Прошлые anonymous visits и просмотры до rollout восстановить из этих таблиц нельзя.

## Учёт подписок — отдельное направление

MembershipEntitlement подтверждает доступ, Telegram join подтверждает участие, outbound acquisition
URL — намерение перейти. Ни одно из них не подтверждает оплату.

Источник событий purchase, renewal, cancellation и expiration выбран и проверен по коду в
[контракте измерений подписочной аналитики v1](../specifications/subscription-analytics-measurement-v1.md):
это journal-таблицы billing. Там же зафиксированы идентификация Account, dedupe без provider event ID,
поведение поздней сверки, границы backfill и пять разрывов до отчёта, включая нереализованные
возвраты. Контракт ждёт решения владельца и до него не меняет readiness зависимых задач.

Направление независимо от #325; delivery ticket отчёта заводится после принятия контракта. Не
вводить billing authority, выручку, MRR или cohort retention из предположений. Новые credentials,
paid/trial services, provider enablement и исторический импорт не разрешены этим планированием.

## Проверяемый результат

У каждого показателя есть определение, владелец факта, пример и предел точности. Итоговые counts
сходятся на deterministic dataset с повторными/опоздавшими событиями, automation, сменой дня и
timezone. Unknown/zero/unavailable различимы. Viewer без отдельного permission не получает отчёт;
личные события не публикуются участникам. Проверки retention/deletion и disabled-tracking входят
в capture acceptance. Статистика не обещает доказать усвоение или покупку.

## Задачи поставки

- [#333](https://github.com/sachkov-inside/platform/issues/333) — Показатели автора имеют проверяемые определения и не обещают несуществующую точность.
- [#334](https://github.com/sachkov-inside/platform/issues/334) — Появляются достоверные исходные события для авторского отчёта.
- [#335](https://github.com/sachkov-inside/platform/issues/335) — Владелец принимает понятный отчёт с периодом, посещениями и просмотрами материалов.
- [#336](https://github.com/sachkov-inside/platform/issues/336) — Автор выбирает период и получает проверенный отчёт о пользовании платформой.
- [#337](https://github.com/sachkov-inside/platform/issues/337) — Будущий отчёт о подписках опирается на подтверждённые события источника, а не на клики или доступ в чат.
