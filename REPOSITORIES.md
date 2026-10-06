# Репозитории Inside

Карта определяет владельцев кода, документов, текущих задач и выпуска после перехода Telegram в platform.
Согласованный переезд ведётся в [platform#957](https://github.com/sachkov-inside/platform/issues/957).
Решение и границы перехода записаны в [ADR 0031](docs/adr/0031-inside-product-monorepo.md).

| Репозиторий | Текущая роль | Статус перехода |
|---|---|---|
| [platform](https://github.com/sachkov-inside/platform) | Код Platform, приложение Telegram в `apps/telegram`, общие документы, словарь, контракты, процесс, CI и текущие задачи Inside | Независимые Telegram workflows обслуживают production; выпуск и откат подтверждены в #960 |
| [inside-telegram](https://github.com/sachkov-inside/inside-telegram) | Исторический код, закрытые задачи и неизменяемые legacy Releases `v1`–`v5` | Пять открытых задач перенесены в platform; статус README источника и архивации ведётся в #961 |
| [workspace](https://github.com/sachkov-inside/workspace) | Исходные документы и история решений для проверки происхождения и отката | Текущие документы принадлежат Platform; оставшийся переход ведётся в #957 |
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

Пять открытых задач Telegram штатно перенесены в platform:
[#978](https://github.com/sachkov-inside/platform/issues/978),
[#979](https://github.com/sachkov-inside/platform/issues/979),
[#980](https://github.com/sachkov-inside/platform/issues/980),
[#981](https://github.com/sachkov-inside/platform/issues/981) и
[#982](https://github.com/sachkov-inside/platform/issues/982).
Проверенная карта старых и новых номеров и статус архивации источника ведутся в
[platform#961](https://github.com/sachkov-inside/platform/issues/961).
Ссылки на закрытые исходные задачи сохраняются как исторические.
Состояние локальных каталогов и окружений ведётся отдельно в
[platform#962](https://github.com/sachkov-inside/platform/issues/962).
