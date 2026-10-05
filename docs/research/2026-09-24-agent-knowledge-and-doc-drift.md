# Знания агентов и расхождение документации с кодом

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-agent-knowledge-and-doc-drift.md); текущие правила — [документы Platform](../../README.md).

**Дата проверки:** 2026-09-24. **Статус:** исследовательские наблюдения и рекомендация для
обсуждения с владельцем, не принятое решение.

Проверены официальная документация runtime'ов, спецификации открытых стандартов, статьи
вендоров и исходный код инструментов. У большинства страниц документации даты публикации
нет; для них указана дата проверки 2026-09-24. Состояние Inside проверено по `origin/main`
Workspace, `platform`, `inside-telegram` и `inside-landing` на ту же дату. Утверждения, которые
не удалось подтвердить первичным источником, помечены «не подтверждено». Выводы, которые
следуют из документации, но не проверялись запуском runtime, помечены «вывод, в runtime не
проверено».

## 1. Краткий вывод

`AGENTS.md` стал фактическим стандартом общих инструкций для агентов. С 9 декабря 2025 года
им управляет Agentic AI Foundation в Linux Foundation, его читают Codex, Cursor, Copilot,
OpenCode, Kiro, Cline и Claude Code (последний — напрямую с v2.1.277 или через импорт из
`CLAUDE.md`). Agent Skills с 18 декабря 2025 года — открытый стандарт с постепенной
подгрузкой; его поддерживают все runtime'ы, которые использует Inside. Локальная память
runtime'ов (auto memory у Claude Code, memories у Codex, Copilot Memory) у всех вендоров
описана как вспомогательный слой, привязанный к машине или сервису. OpenAI прямо пишет, что
обязательные правила команды должны жить в `AGENTS.md` или в документации в репозитории.
Для расхождения документации с кодом зрелые и дешёвые средства — детерминированные проверки
в CI: генерация с режимом `--check`, линтеры ссылок и путей, исполняемые примеры,
ADR-статусы, fitness functions. Экспериментальными остаются агентные механизмы: хуки
остановки с разным форматом у каждого runtime, doc-gardening агенты по расписанию
(GitHub Agentic Workflows — public preview) и синхронизация spec и кода в spec-kit и Kiro.
Inside уже закрывает многое в `platform` (`docs:check`, `api:check`, `mcp:check`, контракт
сопровождения документации). Главные пробелы — около 36 из 38 записей auto memory Claude
Code с проектным знанием, которое не видят другие агенты, и отсутствие проверки harness в CI
продуктовых репозиториев.

## 2. Вопрос 1. Знания для агентов — в versioned harness, а не в памяти runtime

### 2.1. Карта механизмов по runtime

«Подгрузка» — когда содержимое попадает в контекст модели. «Всегда» — при старте сессии;
«по пути» — когда агент читает файл, подходящий под шаблон; «по решению» — агент сам
подгружает тело после того, как увидел имя и описание.

| Механизм | Runtime | Где лежит | Подгрузка | Источник |
|---|---|---|---|---|
| `AGENTS.md` | стандарт; >60 тыс. проектов | корень и подкаталоги | ближайший к файлу главнее; явный prompt пользователя главнее всего | [agents.md](https://agents.md/) |
| `AGENTS.md`, `AGENTS.override.md` | Codex | `~/.codex`, затем от корня Git вниз до cwd | всегда; не больше одного файла на каталог; лимит `project_doc_max_bytes` 32 KiB на сумму | [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) |
| `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md` | Claude Code | managed → user → project → local | всегда; файлы складываются; подкаталоги — по требованию | [Claude Code memory](https://code.claude.com/docs/en/memory) |
| `@path` импорт | Claude Code | внутри `CLAUDE.md`/`AGENTS.md` | вместе с файлом; глубина до 4 переходов | там же |
| `AGENTS.md` напрямую | Claude Code ≥ v2.1.277 | корень и подкаталоги | только если нет `CLAUDE.md`/`CLAUDE.local.md` в cwd и выше (режим по умолчанию) | там же |
| `.claude/rules/*.md` с `paths` | Claude Code | `.claude/rules/`, `~/.claude/rules/` | без `paths` — всегда; с `paths` — по пути | там же |
| Auto memory | Claude Code | `~/.claude/projects/<project>/memory/` | `MEMORY.md` всегда (200 строк или 25 KB), темы — по требованию | там же |
| Subagent memory `scope: project` | Claude Code | `.claude/agent-memory/<agent>/` | для этого субагента | [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) |
| Memories | Codex | `~/.codex/memories/` | выключены по умолчанию | [Codex memories](https://learn.chatgpt.com/docs/customization/memories) |
| Skills (`SKILL.md`) | стандарт Agent Skills | `.agents/skills`, `.claude/skills`, `.opencode/skills` и др. | имя и описание всегда; тело — по решению; ресурсы — по мере нужды | [agentskills.io](https://agentskills.io/specification) |
| Skills | Codex | `.agents/skills` от cwd до корня, `$HOME/.agents/skills` | список ≤ 2% контекста или 8000 символов | [Codex skills](https://learn.chatgpt.com/docs/build-skills) |
| Project Rules `.mdc` | Cursor | `.cursor/rules/` (обычные `.md` там игнорируются) | Always / Intelligently / по `globs` / вручную | [Cursor rules](https://cursor.com/docs/context/rules) |
| `AGENTS.md` | Cursor | корень и подкаталоги | вложенные объединяются, конкретный главнее | там же |
| `.github/copilot-instructions.md` | Copilot | `.github/` | всегда | [Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions) |
| `*.instructions.md` с `applyTo` | Copilot | `.github/instructions/` | по пути; на GitHub.com только cloud agent и code review | там же |
| `AGENTS.md` | Copilot | где угодно; ближайший главнее | cloud agent, CLI, code review, VS Code; в VS Code вложенные — эксперимент, выключены | [поддержка](https://docs.github.com/en/copilot/reference/custom-instructions-support), [VS Code](https://code.visualstudio.com/docs/copilot/customization/custom-instructions) |
| Copilot Memory | Copilot | сервис GitHub, в рамках репозитория | факты сверяются с веткой; неиспользуемые удаляются через 28 дней | [Copilot Memory](https://docs.github.com/en/copilot/concepts/agents/copilot-memory) |
| Steering | Kiro | `.kiro/steering/`, `~/.kiro/steering/` | `always` / `fileMatch` / `manual` / `auto` | [Kiro steering](https://kiro.dev/docs/steering/) |
| `AGENTS.md` | Kiro | корень, подкаталоги, `~/.kiro/steering/` | всегда, режимы не применяются | там же |
| `.clinerules/`, `AGENTS.md` | Cline | `.clinerules/`, `.cline/rules/`, `~/.agents/AGENTS.md` | условные правила через `paths:` | [Cline rules](https://docs.cline.bot/customization/cline-rules) |
| Memory Bank | Cline | `memory-bank/*.md` в репозитории | методика через текст в rules, не встроенная функция | [Cline Memory Bank](https://docs.cline.bot/best-practices/memory-bank) |
| `AGENTS.md`, `instructions` | OpenCode | корень, `~/.config/opencode/AGENTS.md`; `CLAUDE.md` как запасной | всегда; `instructions` добавляет пути и globs | [OpenCode rules](https://opencode.ai/docs/rules/) |
| Skills | OpenCode | `.opencode/`, `.claude/`, `.agents/skills/` | по требованию | [OpenCode skills](https://opencode.ai/docs/skills/) |

**Стандарт `AGENTS.md`.** Это обычный Markdown без обязательных полей: «No. AGENTS.md is just
standard Markdown». Правило приоритета: «The closest AGENTS.md to the edited file wins;
explicit user chat prompts override everything.» [agents.md](https://agents.md/). Стандарт
передан в Agentic AI Foundation при Linux Foundation 9 декабря 2025 года; основатели фонда —
Anthropic, Block и OpenAI.
[Пресс-релиз Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation).
На сайте agents.md в списке поддерживающих инструментов Claude Code не указан. Но документация
Claude Code описывает чтение `AGENTS.md` напрямую с v2.1.277.
[Claude Code memory](https://code.claude.com/docs/en/memory).

**Claude Code и `AGENTS.md`: важная тонкость для Inside.** В режиме по умолчанию
(`claude-md-or-agents-md`) Claude читает `AGENTS.md` «only when you have no `CLAUDE.md` in your
working directory or above it». Подкаталоговый `AGENTS.md` читается, только если в этом
подкаталоге нет своего `CLAUDE.md` — и при этом выше тоже нет `CLAUDE.md`. Сменить режим можно
только в user, `--settings` или managed settings: «Claude Code ignores it in project and local
settings files». Для совместимости документация по-прежнему рекомендует `CLAUDE.md` с
`@AGENTS.md`. [Claude Code memory](https://code.claude.com/docs/en/memory).
Следствие для Inside (вывод, в runtime не проверено): в `platform` корневой `CLAUDE.md`
импортирует `AGENTS.md`, у `apps/web` есть мост `CLAUDE.md` → `@AGENTS.md`, а у
`apps/backend/AGENTS.md` моста нет. Поэтому Claude Code в настройках по умолчанию, вероятно,
не загружает инструкции backend, которые видят Codex, Cursor и OpenCode.

**Размер и содержание.** Claude Code: «target under 200 lines per CLAUDE.md file. Longer files
consume more context and reduce adherence» [memory](https://code.claude.com/docs/en/memory).
Best practices: «Keep it concise. For each line, ask: 'Would removing this cause Claude to make
mistakes?' If not, cut it.» и «Treat CLAUDE.md like code: review it when things go wrong, prune
it regularly». Туда стоит класть команды, которые Claude не угадает, особенности окружения и
неочевидные ловушки. Не стоит — то, что видно из кода, и часто меняющиеся данные. Знание,
нужное лишь иногда, лучше вынести в skill.
[Claude Code best practices](https://code.claude.com/docs/en/best-practices). Codex ограничивает
сумму `AGENTS.md` по цепочке 32 KiB по умолчанию.
[Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

**Auto memory Claude Code.** Память лежит в `~/.claude/projects/<project>/memory/`, общая для
всех worktree одного репозитория. Она «machine-local… not shared across machines or cloud
environments». Claude пишет в неё заметки четырёх типов: `user`, `feedback`, `project`,
`reference`. По документации он пропускает то, что можно вывести из кода: «such as
architecture, file paths, or debugging fixes». Каталог переносится настройкой
`autoMemoryDirectory`, но значение должно быть абсолютным путём или начинаться с `~/`.
[Claude Code memory](https://code.claude.com/docs/en/memory). Значит, направить auto memory в
репозиторий переносимо нельзя. Абсолютный путь к checkout привязан к машине. Кроме того,
память общая для всех worktree, а запись шла бы в одно рабочее дерево без ревью. Переносимый
вариант у Claude есть только для субагентов: `memory: project` пишет в
`.claude/agent-memory/<agent>/`, «shareable via version control».
[Claude Code subagents](https://code.claude.com/docs/en/sub-agents). Другие runtime'ы такой
каталог не читают.

**Codex memories.** Хранятся в `~/.codex/memories/`, по умолчанию выключены. Позиция OpenAI:
«Keep required team guidance in AGENTS.md or checked-in documentation. Treat memories as a
helpful recall layer, not as the only source for rules that must always apply.»
[Codex memories](https://learn.chatgpt.com/docs/customization/memories).

**Copilot Memory.** Public preview. Факты хранятся на стороне GitHub со ссылками на код и перед
использованием сверяются с текущей веткой. Неиспользуемые записи удаляются через 28 дней.
[Copilot Memory](https://docs.github.com/en/copilot/concepts/agents/copilot-memory).

**Cursor Memories.** Появились в 1.0 (4 июня 2025) и стали GA в 1.2 (3 июля 2025)
([1.0](https://cursor.com/changelog/1-0), [1.2](https://cursor.com/changelog/1-2)). Сотрудник
Cursor на форуме пишет, что функцию убрали с версии 2.1.x и предлагает экспортировать память
в Rules ([форум, 2025-11-25](https://forum.cursor.com/t/are-my-memories-gone/144057)).
В документации и changelog удаление **не подтверждено**; страница `/docs/context/memories`
сейчас перенаправляет на `/docs/rules`.

**Agent Skills.** Обязательные поля `SKILL.md` — `name` и `description`. Подгрузка идёт в три
уровня: «Metadata (~100 tokens)… loaded at startup», «Instructions (< 5000 tokens recommended)…
loaded when the skill is activated», «Resources (as needed)». Рекомендация: «Keep your main
SKILL.md under 500 lines.» [Спецификация](https://agentskills.io/specification). Стандарт
разработан Anthropic; открытым он стал 18 декабря 2025 года. Это указано в обновлении к посту
от 16 октября 2025 года.
[Anthropic, Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills).
Список клиентов включает Claude Code, Codex, OpenCode, Cursor, GitHub Copilot, Kiro и Gemini
CLI. Kimi Code в списке нет, но этот runtime читает `.agents/skills`. Это следует из
`harness/README.md` Inside; первичным источником Kimi не подтверждено.
[Клиенты](https://agentskills.io/clients).

**Статьи вендоров о контексте и памяти.**

- Anthropic, «Effective context engineering for AI agents», 29 сентября 2025. Цель — «the
  smallest possible set of high-signal tokens». Рекомендуется «just in time» подгрузка по
  лёгким ссылкам: пути к файлам, запросы, URL. Гибрид Claude Code описан так: «CLAUDE.md files
  are naively dropped into context up front, while primitives like glob and grep allow it to
  navigate its environment and retrieve files just-in-time». Отдельно описаны структурированные
  заметки вне окна контекста.
  [Статья](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).
- Anthropic, «Effective harnesses for long-running agents», 26 ноября 2025. Первая сессия
  создаёт «an init.sh script, a claude-progress.txt file… and an initial git commit». Список
  функций хранится в JSON, потому что «the model is less likely to inappropriately change or
  overwrite JSON files compared to Markdown files». Состояние между сессиями живёт в git и
  файлах прогресса, а не в памяти runtime.
  [Статья](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).
- Anthropic, memory tool API. Инструмент работает на стороне клиента: «Claude requests file
  operations, and your application executes them». Операции ограничены каталогом `/memories`.
  Это механизм для собственных агентов на API, не для Claude Code.
  [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool).
- OpenAI, «Harness engineering: leveraging Codex in an agent-first world», Ryan Lopopolo,
  11 февраля 2026. Статья на openai.com закрыта Cloudflare, цитаты сверены по
  [снимку Wayback от 2026-09-13](https://web.archive.org/web/20260913183535/https://openai.com/index/harness-engineering/),
  дата — по RSS OpenAI. [Оригинал](https://openai.com/index/harness-engineering/).
  - «give Codex a map, not a 1,000-page instruction manual.»
  - «The repository's knowledge base lives in a structured docs/ directory treated as the system
    of record. A short AGENTS.md (roughly 100 lines) is injected into context and serves
    primarily as a map».
  - «From the agent's point of view, anything it can't access in-context while running
    effectively doesn't exist.»
  - Про монолитный файл: «It rots instantly. A monolithic manual turns into a graveyard of stale
    rules.»
  - «Dedicated linters and CI jobs validate that the knowledge base is up to date, cross-linked,
    and structured correctly. A recurring "doc-gardening" agent scans for stale or obsolete
    documentation … and opens fix-up pull requests.»
  - «golden principles» кодируются в репозитории и поддерживаются регулярной уборкой, которая
    «functions like garbage collection».

### 2.2. Что где живёт: классификация и критерий

Общий принцип совпадает у всех вендоров. Обязательное для всех агентов знание хранится в
репозитории и проходит ревью. Память runtime — только слой припоминания. Критерий выбора
места — три вопроса по порядку:

1. **Можно ли это проверить машиной?** Если да — нужна проверка, а не текст: тест, lint,
   guardrail, скрипт, `--check`. Это совпадает с уже принятым в Inside правилом
   `Review closure`: «type, schema, test, lint or guardrail first».
2. **Кому это нужно?** Всем агентам в репозитории — в versioned файлы. Только этому человеку
   на всех проектах — в user-level инструкции runtime. Только этой машине — в личную память
   или локальные настройки.
3. **Когда это нужно?** Всегда — корневой `AGENTS.md`. При работе в части кода — вложенный
   `AGENTS.md`. Для конкретной процедуры — skill или `docs/agents/*.md` по ссылке.

| Место | Что туда кладётся | Критерий | Пример для Inside |
|---|---|---|---|
| Тест, lint, guardrail, скрипт | Любое правило, которое машина может проверить; ловушку, которую может убрать скрипт | нарушение можно обнаружить детерминированно | `prisma generate` в `postinstall` или в скрипте lint вместо заметки |
| Корневой `AGENTS.md` | Карта: роль, куда смотреть, главные команды проверки, запреты | нужно в каждой сессии; до ~100–200 строк | уже так в Workspace и `platform` |
| Вложенный `AGENTS.md` (+ мост `CLAUDE.md`) | Команды и правила одной части кода | нужно только при работе в этом каталоге | `apps/backend/AGENTS.md`, `apps/web/AGENTS.md` |
| `docs/agents/*.md` | Процедуры и справка для агентов: трекер, ловушки окружения, сопровождение документации | нужно для определённой задачи; ссылка из `AGENTS.md` по триггеру | `documentation-maintenance.md`, `tracker-automation.md` |
| Skill | Многошаговый переиспользуемый workflow с триггером | повторяемая процедура, нужная иногда и в разных репозиториях | `code-review`, `diagnosing-bugs` |
| Managed-файлы harness (`WORKFLOW.md` и др.) | Общие правила доставки и решения владельца о процессе | касается всех продуктовых репозиториев | правило о продвижении `main` после merge |
| Runbook / README | Процедуры запуска, стендов, деплоя для людей и агентов | эксплуатационная процедура | `docs/runbooks/local-development.md` |
| ADR | Трудно обратимое решение с компромиссом | нужна причина и история | «анимация без Remotion», если это архитектурный выбор |
| Tracker issue | Известный дефект, дрожащий тест, отложенная работа | у проблемы есть конец | дрожащие краш-тесты `notification-transport` |
| User-level инструкции runtime | Личные предпочтения владельца на всех проектах | не зависит от проекта | язык ответа, стиль общения |
| Личная память runtime | Машинные особенности, черновые наблюдения до проверки | привязано к машине или ещё не подтверждено | `memory_pressure` на macOS |

Замечание о «личных предпочтениях». Если предпочтение владельца касается того, как любой агент
должен работать в проекте, это правило проекта, а не личная память. Например: одна-две задачи
на спецификацию или смежный дефект в том же PR. Другие агенты не должны узнавать о нём заново.

### 2.3. Разбор текущей auto memory Claude Code в Inside

В `~/.claude/projects/-Users-dev-Work-Products-inside/memory/` 38 записей и индекс
`MEMORY.md`. По полю `type`: 25 `project`, 11 `feedback`, 2 `reference`. Классы ниже определены
по заголовкам и описаниям. Личное содержимое не копируется.

| Класс | Записей | Примеры заголовков | Куда должно жить |
|---|---|---|---|
| Ловушки окружения и неочевидные команды `platform` | 18 | «prisma:generate после merge схемы», «Lint в свежем worktree требует сборки material-blocks», «Сгенерированные артефакты apps/web», «CI Quality — это pnpm check» | сначала скрипт или проверка; остаток — `platform/docs/agents/` или runbook |
| Дрожащие тесты | 3 | «Дрожащие краш-тесты notification-transport», «Дрожащий тест миграции форматов», «Дрожащее Production Compose по PgBoss» | issue в `platform` + ссылка на него (WORKFLOW уже требует ссылку при повторном запуске) |
| Механика трекера, CI и GitHub | 8 | «Передача в тракер требует связанного PR», «Старт сессии блокируют дети задачи», «CI не стартует при конфликте PR» | исправить скрипт трекера или описать в `docs/agents/tracker-automation.md` через canonical package |
| Решения владельца о процессе | 6 | «Обновлять main после merge», «Одна-две задачи на спеку», «Смежный дефект — в тот же PR» | `WORKFLOW.md` через canonical package |
| Продуктово-техническое решение | 1 | «Анимация на сайте без Remotion» | `platform` ADR или `apps/web/CODING_STANDARDS.md` |
| Машинное и личное | 2 | «Память на macOS: не Pages free», «Запуск рабочих сессий через Herdr» | личная память или user-level инструкции |

Итого 36 из 38 записей — знание проекта, которое Codex, Kimi и OpenCode не видят.

Три наблюдения:

- **Прямое противоречие с harness.** Запись «Обновлять main после merge» фиксирует решение
  владельца от 2026-09-09, обратное правилу `WORKFLOW.md` → `Agent worktrees` («let the owner
  decide when it advances after a merge»). Claude Code выполняет одно правило, остальные агенты —
  другое. Это самый дорогой вид расхождения: он невидим в ревью.
- **Дублирование.** «Уборка worktree и веток» повторяет правило `WORKFLOW.md`
  («Worktree cleanup is the owning writing agent's final task step»). Новое в записи — только
  снятые разрешения в `~/.claude/settings.json`, а это машинная настройка.
- **Расхождение с политикой вендора.** Документация говорит, что auto memory пропускает
  «debugging fixes». Но около половины записей — именно такие исправления. Документация не
  гарантирует этот фильтр, поэтому нужна явная процедура продвижения.

### 2.4. Процедура продвижения уроков в репозиторий

**Официальные позиции.** OpenAI: обязательные правила — в `AGENTS.md` или документации в
репозитории, memories — только припоминание
([Codex memories](https://learn.chatgpt.com/docs/customization/memories)). Anthropic:
«Check CLAUDE.md into git so your team can contribute» и регулярная чистка
([best practices](https://code.claude.com/docs/en/best-practices)). По документации memory,
многошаговые процедуры и знание одной части кода переносятся в skill или path-scoped rule
([memory](https://code.claude.com/docs/en/memory)). Статья OpenAI о harness engineering
описывает репозиторий как system of record. Устаревание знаний там ловят линтеры и регулярный
doc-gardening агент ([статья](https://openai.com/index/harness-engineering/)).

**Мнение практиков, не стандарт.** Cline Memory Bank хранит память прямо в `memory-bank/`
внутри репозитория ([Cline](https://docs.cline.bot/best-practices/memory-bank)). Anthropic
советует вести `claude-progress.txt` и git-историю как межсессионную память
([статья](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)).
Отдельной вендорской процедуры «memory → репозиторий» не найдено. Процедура ниже — предложение
этого исследования, собранное из перечисленных позиций и правила `Review closure` Inside.

Предлагаемая процедура:

1. **Когда.** В конце задачи, в шаге `Pruning` / `Review closure`, агент проверяет, узнал ли он
   за сессию что-то неочевидное: ловушку, команду, решение владельца, дрожащий тест.
2. **Куда.** Выбор по критерию из 2.2: сначала проверка или скрипт; затем issue, если у проблемы
   есть конец; затем ближайший документ-владелец; затем ADR.
3. **Как.** Урок идёт в тот же PR, если относится к задаче. Иначе — отдельный маленький
   `docs/...` PR или issue. Раздел отчёта «Изменения документации» называет, что продвинуто.
4. **Личная память.** В ней остаются только машинные и личные записи. После продвижения запись
   удаляется или сводится к указателю на документ.
5. **Разовый перенос.** Текущие 36 записей проектного знания переносятся одной задачей по
   таблице 2.3. Противоречие с `WORKFLOW.md` владелец решает первым.

## 3. Вопрос 2. Чтобы документация и harness не расходились с кодом

### 3.1. Сводная таблица

Этапы pipeline: Sharpen → Spec → Tickets → Impl (Implementation) → Review → CI → Merge → Post
(post-merge). «Стоимость» — оценка внедрения для Inside: низкая — часы, средняя — дни,
высокая — постоянное сопровождение.

| Практика | Какое расхождение ловит | Зрелость на 2026-09 | Стоимость | Этап | Источник |
|---|---|---|---|---|---|
| Docs-as-code | ничего сама; делает остальные проверки возможными | устоявшаяся (доклады WTD с 2015) | уже есть | все | [WTD](https://www.writethedocs.org/guide/docs-as-code/) |
| Living documentation | документ разошёлся с источником знания | книга 2019 | средняя | Impl, CI | [Martraire](https://www.informit.com/store/living-documentation-continuous-knowledge-sharing-by-9780134689326) |
| Генерация + `--check` | сгенерированное отстало от источника | зрелая, в инструментах | низкая | Impl, CI | [terraform-docs](https://github.com/terraform-docs/terraform-docs/blob/master/docs/reference/terraform-docs.md), [openapi-typescript](https://openapi-ts.dev/cli) |
| Исполняемая документация | примеры и команды перестали работать | doctest, rustdoc — зрелые; runme, mdsh — нишевые | низкая–средняя | Impl, CI | [doctest](https://docs.python.org/3/library/doctest.html), [rustdoc](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html) |
| Линтеры ссылок и путей | битые ссылки, пути, якоря | зрелые (релизы 2026) | низкая | CI | [lychee](https://github.com/lycheeverse/lychee) |
| Правила «путь X → документ Y» | код изменён, документ не тронут | Danger и CODEOWNERS зрелые; Swimm — коммерческий | низкая–средняя | Review, CI | [Danger JS](https://danger.systems/js/), [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) |
| Spec-driven development | код разошёлся со спецификацией | spec-kit v1.0 (2026), Kiro specs; быстро меняются | средняя–высокая | Spec, Tickets, Impl | [spec-kit](https://github.com/github/spec-kit), [Kiro](https://kiro.dev/docs/specs/feature-specs/) |
| Хуки агента (Stop) | агент закончил, не обновив документы | есть у Claude Code, Codex, Cursor; форматы разные | средняя | Impl | [Claude hooks](https://code.claude.com/docs/en/hooks), [Codex hooks](https://developers.openai.com/codex/hooks) |
| Doc-gardening агент по расписанию | смысловое устаревание | gh-aw — public preview | средняя + ревью PR | Post | [gh-aw](https://github.github.io/gh-aw/), [OpenAI](https://openai.com/index/harness-engineering/) |
| ADR lifecycle | потеря причины; действующее решение выглядит отменённым или наоборот | устоявшаяся (2011); MADR 4.0.0 (2024-09-17) | уже есть | Spec, Review | [Nygard](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions), [MADR](https://adr.github.io/madr/) |
| Diátaxis | смешение типов документов | устоявшаяся методика | низкая (как правило письма) | Spec, Impl | [diataxis.fr](https://diataxis.fr/) |
| Fitness functions | архитектура ушла от заявленной | устоявшаяся (Radar Trial, 2018) | средняя | Impl, CI | [Thoughtworks Radar](https://www.thoughtworks.com/radar/techniques/architectural-fitness-function) |
| Автообновление harness в потребителях | потребитель отстал от версии пакета | Renovate regex, Copier — зрелые | низкая–средняя | Post | [Renovate regex](https://docs.renovatebot.com/modules/manager/regex/), [Copier](https://copier.readthedocs.io/en/stable/updating/) |

### 3.2. Практики по отдельности

**Docs-as-code.** Документацию ведут теми же средствами, что и код: трекер, Git, текстовая
разметка, ревью, автотесты. Write the Docs: «You can block merging of new features if they
don't include documentation». [WTD](https://www.writethedocs.org/guide/docs-as-code/). Сама по
себе практика ничего не ловит. Она лишь даёт место для проверок ниже. В Inside уже принята.

**Living documentation (Cyrille Martraire, Addison-Wesley, 4 июня 2019).** Принципы: Reliable,
Low Effort, Collaborative, Insightful. Среди глав — «Setting Up a Reconciliation Mechanism (aka
Verification Mechanism)» и «Running Consistency Tests». Идея: у каждого факта один
авторитетный источник, а документ либо генерируется из него, либо сверяется тестом.
[Издательство](https://www.informit.com/store/living-documentation-continuous-knowledge-sharing-by-9780134689326).
Контракт `platform/docs/agents/documentation-maintenance.md` («one current source of truth for
every durable fact») уже следует этой идее.

**Генерация из кода с `--check`.** Документ или артефакт генерируется из источника. CI падает,
если закоммиченная версия отличается. Первичные примеры режима:
`terraform-docs --output-check` («check if content of output file is up to date»,
[справка](https://github.com/terraform-docs/terraform-docs/blob/master/docs/reference/terraform-docs.md)),
`openapi-typescript --check` («Check that the generated types are up-to-date»,
[CLI](https://openapi-ts.dev/cli)), `prettier --check` ([CLI](https://prettier.io/docs/cli)),
`mdsh --frozen` («Fail if the output is different from the input. Useful for CI»,
[README](https://github.com/zimbatm/mdsh)). Общий шаблон `go generate` + `git diff --exit-code`
и готовые инструменты для схемы env первичным источником **не подтверждены**. Это самый дешёвый
и надёжный класс для реестров, OpenAPI, списков команд и CLI help. В Inside уже есть
`pnpm api:check` и `pnpm mcp:check` в `platform`, а `inside-harness health` проверяет
сгенерированный `REGISTRY.md`.

**Исполняемая документация.** Python doctest: «To check that a module's docstrings are
up-to-date by verifying that all interactive examples still work as documented»
([doctest](https://docs.python.org/3/library/doctest.html)). Rust запускает примеры из
документации через `cargo test --doc`
([rustdoc](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html)).
Для shell-блоков в Markdown есть Runme (v3.17.5, 2026-08-28,
[repo](https://github.com/runmedev/runme)) и mdsh. Стандарта «проверять команды из
`AGENTS.md`» не найдено. Дешёвая замена — держать в `AGENTS.md` только имена скриптов
(`pnpm check`), а сами команды — в `package.json`. `platform` уже так делает («keep exact
executable commands in package/config files»). Тогда достаточно проверить, что упомянутый
скрипт существует.

**Линтеры ссылок и упоминаний.** lychee (v0.24.2, 2026-05-01; lychee-action v2.9.0,
2026-07-09) проверяет ссылки и якоря. Режим `--offline` проверяет только локальные файлы
([lychee](https://github.com/lycheeverse/lychee)). markdown-link-check (v3.15.0, 2026-07-28)
проверяет, что ссылки живые ([repo](https://github.com/tcort/markdown-link-check)). Ловят битые
ссылки и пути. Не ловят устаревший смысл и упоминания имён кода вне ссылок. В Inside
`inside-harness health` (`validate_agent_documents`) и `platform` `pnpm docs:check` уже
проверяют локальные ссылки агентских документов и машинные пути. Но проверяются только
`AGENTS.md`, `CLAUDE.md`, `WORKFLOW.md`, `CODING_STANDARDS.md`, `CONTEXT.md`, `docs/agents/`,
`apps/**` и `SKILL.md`. `product/`, `docs/specifications/`, `docs/adr/`, `REPOSITORIES.md` и
внешние ссылки не покрыты.

**Правила «изменил путь X — обнови документ Y».** Danger JS выполняет правила над diff в CI:
пример — `warn("Please add a changelog entry for your changes.")`, если changelog не изменён
([Danger JS](https://danger.systems/js/); danger-js 14.0.6, 2026-08-27). Danger Ruby умеет
`fail(...)` ([Danger Ruby](https://danger.systems/ruby/)). CODEOWNERS автоматически запрашивает
ревью владельца изменённого пути; можно требовать его одобрение в защите ветки
([GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)).
Для одного владельца CODEOWNERS даёт мало: ревьюер и так один. Фильтр `paths` в GitHub Actions
запускает workflow по путям. Но обязательная проверка, пропущенная фильтром, остаётся в
состоянии Pending и блокирует merge
([workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)).
Swimm Auto-sync обновляет фрагменты кода в документах и валит проверку в CI при расхождении
([Swimm](https://docs.swimm.io/features/keep-docs-updated-with-auto-sync/)). Термин «smart
tokens» в текущей документации **не подтверждён**. Такие правила ловят класс «код изменён,
документ не тронут», но дают ложные срабатывания. Поэтому лучше предупреждать (`warn`), чем
блокировать.

**Spec-driven development.**
- *GitHub spec-kit.* Репозиторий создан 2025-08-21, v1.0.11 вышла 2026-09-24. Порядок работы:
  «Constitution once per project; specify → plan → tasks → implement → converge per feature».
  `/speckit.analyze` проверяет согласованность артефактов до реализации, `/speckit.converge`
  сверяет реализацию с артефактами и дописывает оставшуюся работу
  ([spec-kit](https://github.com/github/spec-kit),
  [reference](https://github.github.io/spec-kit/reference/agentic-sdd.html)).
  Анонс от 2 сентября 2025 называет спецификации «living, executable artifacts that evolve with
  the project» ([GitHub blog](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/)).
- *Kiro specs.* Файлы `requirements.md` (нотация EARS), `design.md`, `tasks.md`. Действие Sync
  Files создаёт задачи под новые требования
  ([feature specs](https://kiro.dev/docs/specs/feature-specs/),
  [best practices](https://kiro.dev/docs/specs/best-practices/), обновлено 2026-08-04).
- *Tessl.* Позиционирование «spec-as-source» в текущей документации **не подтверждено**.
  Сейчас Tessl описывает себя как платформу для skills и governance с поиском «drift, overlap,
  and unmanaged copies» skills между репозиториями ([docs](https://docs.tessl.io/)).

В обоих живых инструментах источником считается спецификация. Синхронизацию делает агент по
команде, а не детерминированная проверка. Pipeline Inside уже устроен так же:
`to-spec` → `to-tickets` → `implement`, а в `code-review` есть ось Spec. Отдельный инструмент
не нужен. Полезная идея — шаг «converge»: в конце реализации сверить результат со
спецификацией и явно дописать остаток.

**Хуки агентов.**
- *Claude Code.* Событие `Stop` может не дать агенту остановиться: `decision: "block"` с
  обязательным `reason` или выход с кодом 2 (stderr уходит Claude). Есть защита от цикла
  `stop_hook_active`, а после 8 блокировок подряд Claude Code всё равно завершает ход.
  Документация прямо разделяет роли: инструкции — «context, not enforced configuration», а для
  жёсткого запрета нужен `PreToolUse` hook
  ([hooks](https://code.claude.com/docs/en/hooks), [memory](https://code.claude.com/docs/en/memory)).
- *Codex CLI.* Есть хуки (`hooks.json` или `[hooks]` в `config.toml`, в том числе
  `<repo>/.codex/`): `PreToolUse`, `PostToolUse`, `Stop` и другие. `Stop` с
  `{"decision":"block"}` продолжает работу новым prompt'ом
  ([Codex hooks](https://developers.openai.com/codex/hooks)).
- *Cursor.* Событие `stop` может отправить `followup_message`, по умолчанию не больше 5 раз
  ([Cursor hooks](https://cursor.com/docs/agent/hooks)).

Хук ловит «агент закончил, не обновив документы». Но у каждого runtime свой формат, а
`harness/README.md` Inside намеренно не предполагает хуков. Переносимая замена — та же проверка
как скрипт в полной верификации репозитория, которую выполняет любой агент и CI. Хук поверх
неё — лишь ускоритель для одного runtime.

**Doc-gardening агенты по расписанию.** OpenAI описывает регулярного «doc-gardening» агента,
который ищет устаревшую документацию и открывает PR с исправлениями
([статья](https://openai.com/index/harness-engineering/)). GitHub Agentic Workflows (gh-aw) —
«in Public Preview», движки Copilot, Claude Code, Codex. Один из сценариев — «Automatically
detect drift between code and documentation and propose reviewable updates»
([FAQ](https://github.github.io/gh-aw/reference/faq/), [главная](https://github.github.io/gh-aw/);
v0.89.21, 2026-09-23). Страница GitHub Next всё ещё называет проект исследовательским
прототипом «not a product and not even a technical preview»; вероятно, она устарела
([GitHub Next](https://githubnext.com/projects/agentic-workflows/)). Готовые примеры — «Daily
Documentation Updater», «Link Checker», «Documentation Unbloat» в
[githubnext/agentics](https://github.com/githubnext/agentics). Continuous AI — рамка GitHub Next
со статусом WIP ([Continuous AI](https://githubnext.com/projects/continuous-ai/)). Практика
ловит смысловое устаревание, которое не видит детерминированная проверка. Цена — поток PR,
которые владелец должен читать, и расход на агента.

**ADR lifecycle.** Nygard (15 ноября 2011): ADR хранятся в репозитории. Статусы — «proposed»,
«accepted», «deprecated», «superseded». Отменённое решение сохраняется с пометкой superseded.
Обоснование: «Large documents are never kept up to date. Small, modular documents have at least
a chance at being updated.»
([Nygard](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions)).
MADR 4.0.0 вышел 2024-09-17 ([MADR](https://adr.github.io/madr/),
[adr.github.io](https://adr.github.io/)). В Inside статусы и цепочку supersede уже проверяет
`inside-harness health`. Устаревание содержания самого ADR не проверяется и не должно:
ADR — история.

**Diátaxis.** Четыре типа документов: tutorials, how-to guides, reference, explanation
([diataxis.fr](https://diataxis.fr/)). Прямой проверки устаревания нет. Польза косвенная:
reference удобнее всего генерировать и проверять машиной, а explanation меняется редко. Если
не смешивать типы, меньше текста устаревает при изменении кода. Автор предупреждает, что это
не план структуры, а способ органического роста
([how to use](https://diataxis.fr/how-to-use-diataxis/)).

**Fitness functions.** Определение по Thoughtworks Radar (Trial, 2018): «An architectural
fitness function, as defined in Building Evolutionary Architectures, provides an objective
integrity assessment of some architectural characteristics»
([Radar](https://www.thoughtworks.com/radar/techniques/architectural-fitness-function)).
Механизмы — «tests, metrics, monitoring, logging»
([Neal Ford](https://nealford.com/books/buildingevolutionaryarchitectures.html)). Дата 2-го
издания (O'Reilly, 2022) взята из поисковой выдачи и первичным источником **не подтверждена**.
Раздел `Architecture fitness` в `WORKFLOW.md` Inside уже требует fitness function для каждого
долговечного архитектурного правила. Там же сказано, что `inside-harness health` владеет
fitness харнеса. Логичное расширение — считать синхронность документации тоже fitness
function.

**Автоматическое обновление harness в потребляющих репозиториях.**
- *Renovate.* Custom manager `regex` находит версии в произвольных файлах: «you can configure
  Renovate so it finds dependencies that are not detected by its other built-in package
  managers». Вместе с datasource `git-refs` или `github-tags` он может следить за тегами
  `inside-engineering-v*` и открывать PR
  ([regex](https://docs.renovatebot.com/modules/manager/regex/),
  [git-refs](https://docs.renovatebot.com/modules/datasource/git-refs/),
  [github-tags](https://docs.renovatebot.com/modules/datasource/github-tags/)). Ограничение:
  Renovate поменяет строку версии, но не запустит `inside-harness update`. Нужен postUpgrade
  шаг или отдельный workflow. Возможность postUpgradeTasks на hosted Renovate в этом
  исследовании **не проверялась**.
- *Dependabot* поддерживает только фиксированный список экосистем. Произвольного файла с
  версией в нём нет
  ([supported ecosystems](https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories)).
  Для harness Inside он не подходит.
- *Scheduled workflow + create-pull-request.* Workflow по расписанию выполняет `update` и
  открывает PR через `peter-evans/create-pull-request` (v8.1.1, 2026-04-10): «The changes will be
  automatically committed to a new branch and a pull request created»
  ([repo](https://github.com/peter-evans/create-pull-request)). Проще всего ложится на
  существующий `inside-harness update`, но требует доступа к приватному Workspace.
- *Шаблонные инструменты.* `copier check-update` возвращает код 2 при наличии обновления, а
  `copier update` сводит изменения шаблона
  ([Copier](https://copier.readthedocs.io/en/stable/updating/); v9.18.2, 2026-09-07). `cruft
  check` предназначен для CI («to ensure projects don't unintentionally drift»), но последний
  релиз вышел 2024-12-25 ([cruft](https://cruft.github.io/cruft/)). Переход на Copier заменил бы
  собственный installer. Для Inside это избыточно.

## 4. Как это ложится на pipeline Inside

| Этап | Уже есть | Чего нет |
|---|---|---|
| Sharpen | `grilling`, `grill-with-docs`; `docs/agents/domain.md` направляет к документу-владельцу | — |
| Specification | `to-spec`; контракт issue в `WORKFLOW.md` → `Issue contract`; ADR с проверкой статусов | правило «какие документы меняет эта спецификация» как поле спецификации |
| Tickets | `to-tickets`; критерии приёмки и `verification` в контракте issue | пункт «обновление документов» в критериях приёмки тикета |
| Implementation | `Ready and Done` требует обновлять документы и ADR при изменённом решении; в `platform` — `documentation-maintenance.md` и `pnpm docs:check`; `Pruning` требует чистки | шаг продвижения уроков сессии (2.4); аналогичный контракт в Workspace и `inside-telegram`; мост `CLAUDE.md` у `apps/backend` |
| Review | `code-review` с осями Standards и Spec; `Review closure` с правилом «test, lint or guardrail first» | вопрос ревью «какие документы должны были измениться»; предупреждение по путям (Danger или скрипт) |
| CI | Workspace: `harness-ci.yml` запускает `health` и `diff`; `platform` `pnpm check` включает `docs:check`, `api:check`, `mcp:check`; ADR-проверки в `health` | в `platform` и `inside-telegram` нет проверки managed-файлов harness; не проверяются ссылки в `product/`, `docs/specifications/`, `docs/adr/`, внешние ссылки |
| Merge | отчёт по шаблону PR с разделом «Изменения документации»; owner gate | — |
| Post-merge | `README.md` harness → `Releasing an update`: ручная раскатка по одному репозиторию | автоматический PR обновления harness; регулярная проверка устаревания (doc-gardening или хотя бы lychee по расписанию) |

Уточнение по версиям на 2026-09-24. `platform` и `inside-telegram` на `origin/main` уже на
0.4.7, как и канонический пакет. `inside-landing` на 0.4.4, но он deprecated с 2026-09-15, и
`WORKFLOW.md` запрещает в нём PR. Значит, это ожидаемое состояние, а не расхождение. Проверка
в CI потребителей всё равно нужна. `.inside-harness/product-harness.json` хранит только версию
и списки файлов, без хешей. Поэтому локальную правку managed-файла в потребителе видит лишь
`inside-harness health`, запущенный из Workspace.

## 5. Рекомендация

Порядок выбран так: сначала убрать расхождение, которое уже влияет на поведение агентов, потом
дешёвые детерминированные проверки, и только потом агентные механизмы.

1. **Перенести проектное знание из auto memory Claude Code в репозитории.** Одна задача по
   таблице 2.3. Начать с противоречия «обновлять main после merge»: владелец решает, какое
   правило верное, и оно меняется в canonical `WORKFLOW.md`. Ловушки `platform` сначала
   пробуем убрать скриптом, остаток уходит в `platform/docs/agents/`. Дрожащие тесты
   становятся issue. *Почему первым:* это единственное место, где агенты уже ведут себя
   по-разному, и перенос не требует новых инструментов.
2. **Добавить в `WORKFLOW.md` правило продвижения уроков.** Коротко, в `Pruning` или
   `Review closure`: неочевидное знание сессии уходит в тест, скрипт, документ-владелец или
   issue; личная память runtime — только для машинного и личного. *Почему:* без правила
   память снова накопится. Правило стоит одну правку canonical package и раскатку.
3. **Добавить проверку harness в CI потребителей.** Вариант А: записывать SHA-256 managed-файлов
   в `product-harness.json` при `install`/`update`, а `health` в потребителе проверять без
   Workspace. Вариант Б: CI потребителя получает Workspace по тегу с токеном. *Почему:*
   Workspace CI проверяет только сам Workspace. Вариант А не требует секретов (это предложение
   исследования, а не вендорская практика).
4. **Расширить проверку ссылок и мостов.** Добавить `product/`, `docs/specifications/`,
   `docs/adr/`, `REPOSITORIES.md` в локальную проверку ссылок (свой код в `health` или
   `lychee --offline`). В `health` проверять, что у каждого вложенного `AGENTS.md` есть мост
   `CLAUDE.md`, если Claude Code его иначе не прочитает. *Почему:* низкая стоимость, закрывает
   найденный пробел с `apps/backend` и расширяет то, что уже работает для агентских документов.
5. **Автоматический PR обновления harness — после шага 3.** Scheduled workflow в Workspace после
   релизного тега запускает `update` в каждом активном потребителе и открывает PR через
   `create-pull-request`. *Почему после:* без проверки в CI потребителя такой PR нечем
   подтвердить.

**Отложить:**
- *Хуки Stop.* Три несовместимых формата, а harness намеренно без хуков. Та же проверка как
  скрипт полной верификации работает для всех runtime.
- *Doc-gardening агент по расписанию.* gh-aw в public preview; каждый PR требует времени
  владельца. Вернуться, когда детерминированные проверки перестанут находить проблемы, а
  смысловое устаревание станет заметным.
- *spec-kit, Kiro, Tessl.* Pipeline Inside уже покрывает их роль. Шаг «converge» можно
  добавить в `implement` словами, без инструмента.
- *Danger и CODEOWNERS.* При одном владельце-ревьюере пользы мало. Если нужна связь путей с
  документами, хватит предупреждения в скрипте `docs:check`.
- *Copier или cruft вместо своего installer'а.* Смена инструмента без явной выгоды; у cruft нет
  релизов с декабря 2024.
- *`autoMemoryDirectory` в репозиторий.* Документация требует абсолютный путь. Это непереносимо
  и пишет в одно рабочее дерево без ревью.

## 6. Решения владельца и открытые вопросы

Решения владельца от 2026-09-24:

- **Основной checkout после merge.** Агент сам делает fast-forward основного checkout. Правило
  переносится из auto memory в canonical `WORKFLOW.md` → `Agent worktrees` вместо текущей
  формулировки «let the owner decide when it advances after a merge».
- **Auto memory.** Auto memory Claude Code выключается глобально, а проектное знание переносится
  в harness репозиториев. Порядок исполнения — предмет Specification: выключение до переноса
  лишит агентов уже накопленных записей.
- **Проверка harness в CI потребителей.** Не нужна: владелец не правит managed-файлы вручную.
  Шаг 3 рекомендации снимается; автоматический PR обновления проверяется CI потребителя как
  обычный PR.
- **Число задач на спецификацию.** Универсального правила нет; нарезку решают на этапе
  `to-tickets` для каждой спецификации. Запись auto memory об «одной-двух задачах» не
  переносится в `WORKFLOW.md`.
- **Нарезка работы.** Одна общая спецификация.

Открытые вопросы:

1. Как проверять, что агент, изменив код, бизнес-логику или правило, обновил harness и
   документацию, и не выдумал правило? Владелец считает тему шире контракта сопровождения
   документации `platform` и, возможно, связанной с evals. Она разбирается в отдельном
   исследовании `2026-09-24-verifying-agent-context-updates.md`.
2. Готов ли владелец читать регулярные PR от doc-gardening агента, и с какой частотой?

## 7. Источники

Дата проверки всех ссылок — 2026-09-24. Если на странице есть дата публикации или обновления,
она указана.

**Стандарты и runtime'ы**
- [agents.md](https://agents.md/) — дата не указана.
- [Linux Foundation: Agentic AI Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) — 2025-12-09.
- [Claude Code: memory](https://code.claude.com/docs/en/memory) — дата не указана.
- [Claude Code: best practices](https://code.claude.com/docs/en/best-practices) — дата не указана.
- [Claude Code: subagents](https://code.claude.com/docs/en/sub-agents) — дата не указана.
- [Claude Code: hooks](https://code.claude.com/docs/en/hooks) — дата не указана.
- [Codex: AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) — дата не указана; прежний адрес `developers.openai.com/codex/guides/agents-md` перенаправляет сюда.
- [Codex: skills](https://learn.chatgpt.com/docs/build-skills) — дата не указана.
- [Codex: memories](https://learn.chatgpt.com/docs/customization/memories) — дата не указана.
- [Codex: hooks](https://developers.openai.com/codex/hooks) — дата не указана.
- [Agent Skills: specification](https://agentskills.io/specification), [clients](https://agentskills.io/clients), [home](https://agentskills.io/home) — даты не указаны.
- [Cursor: rules](https://cursor.com/docs/context/rules), [hooks](https://cursor.com/docs/agent/hooks) — даты не указаны.
- [Cursor changelog 1.0](https://cursor.com/changelog/1-0) — 2025-06-04; [1.2](https://cursor.com/changelog/1-2) — 2025-07-03.
- [Cursor forum: Are my memories gone?](https://forum.cursor.com/t/are-my-memories-gone/144057) — 2025-11-25, ответ сотрудника, не документация.
- [GitHub Copilot: repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions), [support matrix](https://docs.github.com/en/copilot/reference/custom-instructions-support), [Copilot Memory](https://docs.github.com/en/copilot/concepts/agents/copilot-memory) — даты не указаны.
- [VS Code: custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions) — 2026-09-16.
- [Kiro: steering](https://kiro.dev/docs/steering/) — 2026-09-02.
- [Cline: rules](https://docs.cline.bot/customization/cline-rules), [Memory Bank](https://docs.cline.bot/best-practices/memory-bank) — даты не указаны.
- [OpenCode: rules](https://opencode.ai/docs/rules/), [skills](https://opencode.ai/docs/skills/) — 2026-09-24.

**Статьи вендоров**
- [Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — 2025-09-29.
- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — 2025-11-26.
- [Anthropic: Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) — 2025-10-16, обновление 2025-12-18.
- [Claude API: memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) — дата не указана.
- [OpenAI: Harness engineering](https://openai.com/index/harness-engineering/) — 2026-02-11; цитаты по [снимку Wayback](https://web.archive.org/web/20260913183535/https://openai.com/index/harness-engineering/).

**Практики против расхождения**
- [Write the Docs: Docs as Code](https://www.writethedocs.org/guide/docs-as-code/) — дата не указана.
- [Martraire, Living Documentation](https://www.informit.com/store/living-documentation-continuous-knowledge-sharing-by-9780134689326) — 2019-06-04.
- [Diátaxis](https://diataxis.fr/), [How to use Diátaxis](https://diataxis.fr/how-to-use-diataxis/) — даты не указаны.
- [Nygard: Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — 2011-11-15.
- [adr.github.io](https://adr.github.io/), [MADR](https://adr.github.io/madr/) — MADR 4.0.0 от 2024-09-17.
- [Thoughtworks Radar: Architectural fitness function](https://www.thoughtworks.com/radar/techniques/architectural-fitness-function) — 2018-05-15; [Neal Ford: Building Evolutionary Architectures](https://nealford.com/books/buildingevolutionaryarchitectures.html) — дата не указана.
- [Python doctest](https://docs.python.org/3/library/doctest.html) — 2026-09-24; [rustdoc documentation tests](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html) — дата не указана.
- [mdsh](https://github.com/zimbatm/mdsh) — дата не указана; [Runme](https://github.com/runmedev/runme) — v3.17.5, 2026-08-28.
- [lychee](https://github.com/lycheeverse/lychee) — v0.24.2, 2026-05-01; [markdown-link-check](https://github.com/tcort/markdown-link-check) — v3.15.0, 2026-07-28.
- [terraform-docs reference](https://github.com/terraform-docs/terraform-docs/blob/master/docs/reference/terraform-docs.md) — v0.24.0, 2026-05-10; [openapi-typescript CLI](https://openapi-ts.dev/cli), [Prettier CLI](https://prettier.io/docs/cli) — даты не указаны.
- [Danger JS](https://danger.systems/js/) — 14.0.6, 2026-08-27; [Danger Ruby](https://danger.systems/ruby/) — дата не указана.
- [GitHub CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners), [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) — даты не указаны.
- [Swimm Auto-sync](https://docs.swimm.io/features/keep-docs-updated-with-auto-sync/) — дата не указана.
- [GitHub spec-kit](https://github.com/github/spec-kit) — v1.0.11, 2026-09-24; [spec-kit reference](https://github.github.io/spec-kit/reference/agentic-sdd.html); [GitHub blog о spec-kit](https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/) — 2025-09-02.
- [Kiro feature specs](https://kiro.dev/docs/specs/feature-specs/), [best practices](https://kiro.dev/docs/specs/best-practices/) — 2026-08-04; [Introducing Kiro](https://kiro.dev/blog/introducing-kiro/) — 2025-07-14.
- [Tessl docs](https://docs.tessl.io/) — дата не указана.
- [GitHub Agentic Workflows](https://github.github.io/gh-aw/), [FAQ](https://github.github.io/gh-aw/reference/faq/) — v0.89.21, 2026-09-23; [GitHub Next: Agentic Workflows](https://githubnext.com/projects/agentic-workflows/) — 2025-08; [Continuous AI](https://githubnext.com/projects/continuous-ai/) — 2025-06; [githubnext/agentics](https://github.com/githubnext/agentics) — дата не указана.

**Обновление harness**
- [Renovate regex manager](https://docs.renovatebot.com/modules/manager/regex/), [git-refs](https://docs.renovatebot.com/modules/datasource/git-refs/), [github-tags](https://docs.renovatebot.com/modules/datasource/github-tags/) — даты не указаны.
- [Dependabot supported ecosystems](https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories) — дата не указана.
- [peter-evans/create-pull-request](https://github.com/peter-evans/create-pull-request) — v8.1.1, 2026-04-10.
- [Copier: updating](https://copier.readthedocs.io/en/stable/updating/) — v9.18.2, 2026-09-07; [cruft](https://cruft.github.io/cruft/) — 2.16.0, 2024-12-25.

**Состояние Inside (исходный код, `origin/main` на 2026-09-24)**
- Workspace: `harness/packages/inside-engineering/WORKFLOW.md`, `manifest.json` (0.4.7), `harness/bin/inside-harness` (`health_command`, `validate_repository_architecture`, `validate_agent_documents`), `.github/workflows/harness-ci.yml`.
- `platform`: `AGENTS.md`, `apps/backend/AGENTS.md` (без `CLAUDE.md`), `apps/web/CLAUDE.md`, `docs/agents/documentation-maintenance.md`, `scripts/check-agent-documentation.mjs`, `package.json` (`docs:check`, `api:check`, `mcp:check`, `check`), `.github/workflows/ci.yml`, `.inside-harness/product-harness.json`.
- `inside-telegram`, `inside-landing`: `.inside-harness/product-harness.json`, `.github/workflows/`.
