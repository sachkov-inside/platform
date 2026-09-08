# Billing integration v1: переносимый контракт

Статус: proposal Platform #403, исходная граница принята в Workspace PR #151.
[Локальная specification](../../specifications/subscription-billing-v1.md) задаёт use cases,
владельцев состояния, REST/MCP inventory и delivery gates. Этот bundle задаёт только новые
межсервисные сообщения; старые identity/evidence/communications версии не расширяются.

## Артефакты и принятие

- [schema.json](schema.json) — JSON Schema draft-07, closed objects и три explicit contractVersion.
- [fixtures.json](fixtures.json) — положительные/отрицательные wire examples.
- [scenarios.json](scenarios.json) — нормативные последовательности с ожидаемыми исходами и
  owning implementation tickets. Это вход в будущие runtime tests, не готовый симулятор.
- [protocol.md](protocol.md) — нормативные transport, auth, idempotency и recovery правила.
- [manifest.json](manifest.json) — SHA-256 bundle и исходников, exact Workspace revision.
- [product source](sources/subscription-billing-v1.txt) и [shared boundary source](sources/subscription-access-v1.txt)
  — неизменённые bytes исходных Markdown в `.txt`, чтобы их оригинальные относительные ссылки
  не выдавались за локальные ссылки копии. Они разрешаются относительно sourcePath/sourceCommit
  manifest; для исполнения достаточно локальных текстов и specification, сетевого импорта нет.

Platform #403 владеет первой версией wire schema и protocol. Telegram #54 копирует protocol.md,
schema.json, fixtures.json, scenarios.json, manifest.json и sources/ byte-for-byte
из merged Platform commit и записывает этот commit в собственном provenance metadata. Изменение
required field, semantics или enum требует новой contractVersion и согласованной поставки обеих
сторон; действующий v1 не расширяется неизвестными полями. Обновление digest не заменяет review.

Ajv draft-07 и ajv-formats уже используются репозиторием; [официальная документация](https://ajv.js.org/json-schema.html#draft-07-default)
подтверждает default dialect. Tests проверяют fixtures/shape/hash; chronological, revision,
identity и stateful assertions ниже проверяют runtime tickets, не JSON Schema самостоятельно.

