# Репозитории Inside

Карта определяет текущих владельцев кода, документов, задач и выпуска Inside, а также исторические источники.
Согласованный переезд ведётся в [platform#957](https://github.com/sachkov-inside/platform/issues/957)
по [workspace#253](https://github.com/sachkov-inside/workspace/issues/253).
Решение и границы перехода записаны в [ADR 0031](docs/adr/0031-inside-product-monorepo.md).

| Репозиторий | Текущая роль | Состояние |
|---|---|---|
| [platform](https://github.com/sachkov-inside/platform) | Код Platform, приложение Telegram в `apps/telegram`, общие документы, словарь, контракты, процесс, CI и текущие задачи Inside | Независимые Telegram workflows обслуживают production; выпуск и откат подтверждены в #960 |
| [inside-telegram](https://github.com/sachkov-inside/inside-telegram) | Исторический код, закрытые задачи и неизменяемые legacy Releases `v1`–`v5` | Архивирован; README направляет в platform, пять открытых задач перенесены; #961 завершён |
| [workspace](https://github.com/sachkov-inside/workspace) | Исторический источник документов и решений для проверки происхождения и отката | Актуальная работа в platform; окончательная архивация ведётся в #962 |
| [inside-content](https://github.com/sachkov-inside/inside-content) | Закрытые редакционные оригиналы, метаданные и процесс подготовки материалов | Остаётся отдельным репозиторием |
| [workshop-cases](https://github.com/sachkov-inside/workshop-cases) | Закрытые Tracks, Laboratories, CaseSpec и авторские решения | Остаётся отдельным источником; не становится runtime Platform |
| [ai-engineering](https://github.com/sachkov-inside/ai-engineering) | Архивированное направление курса | Не возобновляется этим переездом |
| [inside-landing](https://github.com/sachkov-inside/inside-landing) | Исторический landing, deprecated с 2026-09-15 | Этот этап его не меняет |

## Локальное устройство

`inside/` — обычная папка-контейнер без Git. Независимые репозитории стоят рядом:

```text
inside/
├── platform/
├── inside-content/
├── workshop-cases/
└── platform.worktrees/
    └── <task>/
```

Контейнер не владеет общими правилами или процессом разработки.
Агент начинает сессию в репозитории или его worktree и читает локальный `AGENTS.md`.
Размещение и жизненный цикл worktree Platform задаёт [WORKFLOW.md](WORKFLOW.md).
Соседние репозитории сохраняют собственные правила; закрытые авторские материалы остаются у своих владельцев.

Локальную топологию и окончательную архивацию workspace завершает
[platform#962](https://github.com/sachkov-inside/platform/issues/962).
Исторические источники и Releases сохраняются; ссылки на прошлые решения не меняют владельца актуальной работы.

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
Проверенная карта старых и новых номеров и подтверждение архивации источника записаны в
[platform#961](https://github.com/sachkov-inside/platform/issues/961).
Ссылки на закрытые исходные задачи сохраняются как исторические.
