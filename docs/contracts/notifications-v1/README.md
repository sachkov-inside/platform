# Notifications v1: переносимые артефакты

Platform #434 владеет wire schema и protocol; Workspace #152 — shared product/ownership decision.
Контракт — target для реализации, не production proof. [Локальная specification](../../specifications/notifications-v1.md).

- [schema.json](schema.json): JSON Schema draft-07, closed event/delivery/result/authorization shapes.
- [fixtures.json](fixtures.json): valid/invalid examples двух источников и каналов.
- [scenarios.json](scenarios.json): нормативные последовательности для real runtime tests.
- [protocol.md](protocol.md): transport, authorization, correlation, deadlines, replay и unknown.
- [manifest.json](manifest.json): hashes и exact Workspace source revision.
- [sources/notifications-v1.txt](sources/notifications-v1.txt): bytes shared specification;
  относительные ссылки исходника относятся к sourcePath/sourceCommit из manifest.

После [#1054](https://github.com/sachkov-inside/platform/issues/1054) Telegram и backend читают
этот corpus через `@inside/contracts`. Прежние копии bundle и отдельный consumer provenance удалены.
Manifest хранит историческое происхождение corpus; текущий порядок изменения и самостоятельной
поставки задаёт [общий контракт](../README.md). Изменение semantics/required fields/enum после
принятия требует новой version и согласованного corpus обеих сторон. Старый billing corpus
остаётся неизменяемым для community; его notification shapes больше не являются target новой реализации.
