# Общие контракты Platform и Telegram

`docs/contracts` — единственный источник общих wire corpora в этом репозитории.
Папка является workspace-пакетом `@inside/contracts`. Приложения импортируют JSON через его
публичные пути, например `@inside/contracts/notifications-v1/schema.json`, с `with { type: "json" }`.
Протоколы, сценарии и fixtures остаются рядом со схемами. Копий в `apps/` и других пакетах нет.
Runtime codec `CommunityResult` и типы из него принадлежат `@inside/contracts/community-result`;
Platform и Telegram импортируют его вместе с проверкой `groupUrl`. JSON corpora сохраняют
описание v1/v2 для переносимых conformance-проверок. Форматы `date-time` и `uuid` в общем
codec сохраняют прежние правила `ajv-formats`, включая допустимые исторические записи.

## Изменение контракта

Изменяй исходную схему, fixtures и protocol в одном PR. Manifest, snapshot и provenance
сохраняют историческое происхождение corpus; они не задают отдельный runtime pin для приложения.
Если меняются артефакты с digest, обнови соответствующий digest после проверки нового поведения.
Исторические `sources/*.txt` сохраняют исходную спецификацию и не заменяют текущий protocol.

`pnpm guardrails` запрещает повторные corpus-папки, побайтные копии артефактов и схемы с тем же `$id`
вне этой папки, включая JSON-схемы внутри TS/JS. Отрицательные fixtures проверки исполняет `pnpm test:tooling`.
Схему subscription-activation меняй в исходных Zod codecs backend: `AccountRights` и
`telegram-membership/domain/subscription-activation-wire.ts`. Затем выполняй
`pnpm --filter @inside/backend contracts:generate`; `contracts:check` проверяет полученный JSON.
Communications меняется в общем JSON; backend генерирует из него Zod командой
`pnpm --filter @inside/backend communications:generate`. `communications:check` запрещает расхождение.
Cohorts и sales funnel задаются runtime codecs backend. Обновляй их общие проекции после
`pnpm api:generate`; `pnpm guardrails` сверяет эти проекции с текущими операциями OpenAPI.
Notifications используют общий JSON напрямую в обоих приложениях.

## Самостоятельная поставка

Общий исходный код не связывает запущенные приложения: каждый образ содержит свою сборку пакета.
Процессы, базы данных, миграции и последовательности тегов остаются самостоятельными.
Перед изменением wire проверяй совместимость новых и старых сообщений обеих сторон.
При последовательном выпуске Platform первым сохраняет совместимость со старым Telegram;
Telegram обновляется следующим. Несовместимый контракт получает новую wire version.

Порядок выпуска Telegram определяет
[production runbook](../../apps/telegram/docs/operations/production.md).
Перенос по [#1054](https://github.com/sachkov-inside/platform/issues/1054) сохраняет версии и байты схем.
