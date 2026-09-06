---
status: accepted
---

# Хранить состояние изучения и атомарную историю переходов

Владелец согласовал модель 2026-09-06. ReadingActivity внутри существующего backend владеет
текущим состоянием Account/Material и историей фактических ручных переходов. State, event и receipt
успешной команды записываются атомарно. Чтение использует state; история сохраняет события,
которые нельзя достоверно восстановить после снятия отметки, и даёт основу будущим отчётам.

Один boolean без истории теряет прошлые действия; восстановление state только через replay
усложняет текущие чтения без потребности продукта. Универсальная entity-type progress table
смешала бы ручную отметку с Video resume и будущими заданиями, у которых разные правила.
Принятый компромисс требует хранить transition history и обрабатывать идемпотентность уже в первой
реализации. История не обещает данные о просмотрах, времени обучения или усвоении знаний.

Series progress вычисляется по текущему published составу и отметкам материалов; добавление
материала меняет 5/5 на 5/6. Исторического сертификата завершения нет. VideoPlaybackProgress
остаётся во владении Videos; ReadingState не сбрасывается из-за contentVersion или Membership.

Owning contract: [ReadingActivity](../specifications/reading-activity.md). Ближайшие fitness
functions появятся с backend ticket: real-PostgreSQL concurrency/rollback/replay tests и
ownership guardrail с passing Module case и отрицательным cross-schema fixture. В этом docs-only
изменении схемы/кода ещё нет, поэтому это явно отложенные executable checks, а не заявленные тесты.
