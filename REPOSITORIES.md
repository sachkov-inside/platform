# Репозитории Inside: переходный этап документов

Карта отражает этап [platform#958](https://github.com/sachkov-inside/platform/issues/958)
согласованного переезда [platform#957](https://github.com/sachkov-inside/platform/issues/957).
Решение и границы перехода записаны в [ADR 0031](docs/adr/0031-inside-product-monorepo.md).

| Репозиторий | Владелец на этом этапе | Дальнейшее изменение по #957 |
|---|---|---|
| [platform](https://github.com/sachkov-inside/platform) | Код Platform, общие продуктовые и юридические документы, словарь, контракты и процесс разработки Inside | Telegram будет импортирован в `apps/telegram` с полной историей |
| [inside-telegram](https://github.com/sachkov-inside/inside-telegram) | Пока действующие код, CI, выпуск и задачи приложения Telegram | После проверки импорта, выпуска и отката задачи переносятся, репозиторий архивируется |
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
- [Карта переноса 97 файлов](docs/migrations/958-shared-documents.md) даёт исходные commits и соответствия.

До импорта Telegram ссылки на его application brief, ADR и runbooks остаются ссылками на `inside-telegram`.
Процесс разработки Inside принадлежит `WORKFLOW.md` и `.agents/skills` Platform; Telegram пока получает его копию.
Приложения сохраняют самостоятельные процессы и выпуск. Соседний checkout не является build или runtime-зависимостью.
Архивирование источников и изменение локальных каталогов ещё не выполнены.
