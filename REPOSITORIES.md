# Репозитории Inside: этап независимого выпуска Telegram

Карта отражает этап [platform#960](https://github.com/sachkov-inside/platform/issues/960)
согласованного переезда [platform#957](https://github.com/sachkov-inside/platform/issues/957).
Решение и границы перехода записаны в [ADR 0031](docs/adr/0031-inside-product-monorepo.md).

| Репозиторий | Владелец на этом этапе | Дальнейшее изменение по #957 |
|---|---|---|
| [platform](https://github.com/sachkov-inside/platform) | Код Platform и Telegram в `apps/telegram`, общие документы, словарь, контракты, процесс и CI Inside | Независимые Telegram workflows; production-переход проверяется в #960 |
| [inside-telegram](https://github.com/sachkov-inside/inside-telegram) | История источника, действующий production выпуск и прежние задачи Telegram | После проверки импорта, выпуска и отката задачи переносятся, репозиторий архивируется |
| [workspace](https://github.com/sachkov-inside/workspace) | Исходные документы и история решений остаются доступными для проверки и отката | Архивируется после проверки всего перехода; текущие документы уже принадлежат Platform |
| [inside-content](https://github.com/sachkov-inside/inside-content) | Закрытые редакционные оригиналы, метаданные и процесс подготовки материалов | Остаётся отдельным репозиторием |
| [workshop-cases](https://github.com/sachkov-inside/workshop-cases) | Закрытые Tracks, Laboratories, CaseSpec и авторские решения | Остаётся отдельным источником; не становится runtime Platform |
| [ai-engineering](https://github.com/sachkov-inside/ai-engineering) | Архивированное направление курса | Не возобновляется этим переездом |
| [inside-landing](https://github.com/sachkov-inside/inside-landing) | Исторический landing, deprecated с 2026-09-15 | Этот этап его не меняет |

## Текущие документы

- [Общий brief Inside](docs/product/README.md) определяет продукт и аудиторию.
- [Brief Platform](docs/product/platform-mvp-brief.md) определяет объём приложения.
- [GLOSSARY](GLOSSARY.md) владеет общими и прикладными терминами.
- [Юридический комплект](docs/legal/README.md) владеет редакциями и статусами юридических текстов.
- [Карта учёта 97 исходных файлов](docs/migrations/958-shared-documents.md) даёт исходные commits и соответствия.

[Brief Telegram](apps/telegram/docs/product/telegram-application-brief.md), ADR и runbooks теперь доступны внутри приложения.
Процесс разработки Inside принадлежит корневым `WORKFLOW.md` и `.agents/skills`; копии в Telegram удалены.
Корневой CI Gate проверяет Telegram на PR, merge_group и точном SHA reusable CI.
Выпуск и откат Telegram принадлежат [production runbook](apps/telegram/docs/operations/production.md).
Исторические nested workflows удалены; legacy Releases сохраняются для отката.
Приложения сохраняют самостоятельные процессы и выпуск. Соседний checkout не является build или runtime-зависимостью.
Архивирование источников и изменение локальных каталогов ещё не выполнены.
