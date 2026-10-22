# Репозитории Inside

Карта определяет текущих владельцев кода, документов, задач и выпуска Inside, а также исторические источники.
Согласованный переезд завершён в [platform#957](https://github.com/sachkov-inside/platform/issues/957)
по [workspace#253](https://github.com/sachkov-inside/workspace/issues/253).
Решение и границы перехода записаны в [ADR 0031](docs/adr/0031-inside-product-monorepo.md).

| Репозиторий | Текущая роль | Состояние |
|---|---|---|
| [platform](https://github.com/sachkov-inside/platform) | Код Platform, приложение Telegram в `apps/telegram`, общие документы, словарь, контракты, процесс, CI и текущие задачи Inside | Независимые Telegram workflows обслуживают production; выпуск и откат подтверждены в #960 |
| [inside-telegram](https://github.com/sachkov-inside/inside-telegram) | Исторический код, закрытые задачи и неизменяемые legacy Releases `v1`–`v5` | Архивирован; README направляет в platform, пять открытых задач перенесены; #961 завершён |
| [workspace](https://github.com/sachkov-inside/workspace) | Исторический источник документов и решений для проверки происхождения и отката | Архивирован; актуальная работа в platform; архивация завершена в #962 |
| [engineering-content](https://github.com/sachkov-inside/engineering-content) | Закрытые оригиналы инженерных статей, обзоров, уроков, руководств, заданий и программ | Отдельный репозиторий; Platform остаётся одним из направлений доставки |
| [workshop-cases](https://github.com/sachkov-inside/workshop-cases) | Исторические Tracks, Laboratories, CaseSpec и авторские решения | Мастерская отменена ADR 0033; репозиторий не входит в runtime Platform |
| [ai-engineering](https://github.com/sachkov-inside/ai-engineering) | Архивированное направление курса | Не возобновляется этим переездом |
| [inside-landing](https://github.com/sachkov-inside/inside-landing) | Исторический landing, deprecated с 2026-09-15 | Этот этап его не меняет |

## Локальное устройство

Канонические каталоги после решения владельца от 2026-10-16
([#1520](https://github.com/sachkov-inside/platform/issues/1520)):

```text
~/Work/
├── Products/
│   └── inside-platform/       # Platform, включая apps/telegram
└── Materials/                # общий Obsidian vault
    ├── content-studio/       # оригиналы уроков, заданий и иллюстраций; канал, посты и продвижение
    └── knowledge-base/       # исследования и накопленные знания
```

На 2026-10-22 оригиналы курса живут в `content-studio` (`inside-content` указывает на него), а
каталога `engineering-content` нет; Platform по умолчанию берёт Content оттуда (#1672).

Каждый репозиторий сохраняет собственные правила. Агент начинает сессию в репозитории
или назначенном worktree и читает его `AGENTS.md`.
Размещение и жизненный цикл worktree Platform задаёт [WORKFLOW.md](WORKFLOW.md).
Среда может назначить изолированный worktree вне канонического каталога.
Существующие worktrees и ресурсы других сессий сохраняются.

Прежний `~/Work/Products/inside/` больше не является каноническим контейнером проектов.
Временные совместимые пути обслуживают прежние сессии; новая конфигурация от них не зависит.
Машинная миграция сохраняет workshop-cases, отчёты и исследования платежей в обратимом локальном архиве.
Пути совместимости и архива учитывает координирующая сессия миграции; эта задача их не перемещает.

Engineering Content использует установленные копии правил письма Content Studio и Knowledge Base.
Их исходные правила остаются авторитетными в соответствующих репозиториях.
Переименование сохраняет постоянные ID, включая namespace `inside-content`, и принятые автором материалы.
Platform сохраняет действующий процесс exporter/preview/apply; переезд не публикует материалы.
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
