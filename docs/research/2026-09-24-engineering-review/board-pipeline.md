# Доски и Developer Pipeline Sachkov Inside — аудит 2026-09-24

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-engineering-review/board-pipeline.md); текущие правила — [документы Platform](../../../README.md).

Режим: только чтение. GitHub читался через GraphQL/REST (снимок около 14:20 UTC 24.09.2026). Harness
health запускался на локальных checkout и на снимках `origin/main` (git archive во временной папке),
потому что локальный checkout Workspace отстаёт от `origin/main` на 16 коммитов.

Сырые данные: `data/project{1,2,3}.json`, `data/repos.json`, `data/types.json` рядом с этим файлом.

## 0. Главное

| # | Находка | Серьёзность |
|---|---|---|
| F1 | В Developer Pipeline нет ни одного открытого issue с `Priority=Now`; у 23 из 41 открытого issue пустые Priority и Area. У 11 из 17 `Ready` нет Priority. Очередь для агентов не упорядочена. | high |
| F2 | Status не показывает реальную работу. Ни одного issue в `In progress`/`Review`. Выпуск [workspace#184](https://github.com/sachkov-inside/workspace/issues/184) сегодня идёт полным ходом, но стоит `Blocked` (из-за `ready-for-human`). [platform#468](https://github.com/sachkov-inside/platform/issues/468) стоит `Ready`, хотя работа влита в трёх PR и ждёт приёмки владельца: агент увидит его как свободную задачу. | high |
| F3 | Harness рассогласован: на `origin/main` Workspace/Telegram/Workshop Cases/Platform имеют 0.4.7, Landing 0.4.4 (устарел, это ожидаемо). Health **Platform на `origin/main` падает**: два ADR-0026 (PR #672 и #674, оба 18.09). Platform CI не запускает `inside-harness health`, поэтому ошибку не поймали. | high |
| F4 | Локальный checkout Workspace отстаёт на 16 коммитов (0.4.4 против 0.4.7). Агенты, стартующие из `/Users/dev/Work/Products/inside`, читают старые WORKFLOW и tracker-automation: там нет правил про native issue type, про повторный прогон CI, про несвязывающие PR и нет гейта «releases and deployments». Локальный `health` ложно считает Platform сломанной. | high |
| F5 | Правило «у каждого issue в Project ровно один native type» (с 0.4.5) не соблюдается: у 10 открытых issue нет типа, у ~430 закрытых тоже нет. | medium |
| F6 | Human Backlog: [workspace#68](https://github.com/sachkov-inside/workspace/issues/68) закрыт (`Done`), но его дочерний [#72](https://github.com/sachkov-inside/workspace/issues/72) открыт (`In Progress`). У #207 и #208 нет Priority и type. | medium |
| F7 | `Closes #` и «один task — один PR» на практике не выполняются: в 60 дней 14 PR Platform и 10 PR Workspace на ветках `<type>/<issue>-…` влиты без `Closes`. Это нарезка одного issue на несколько PR (#468 → 3 PR, #184 → 2 PR). WORKFLOW этого не описывает, правило есть только в tracker-automation; решение ждёт в [workspace#194](https://github.com/sachkov-inside/workspace/issues/194) (Inbox). | medium |
| F8 | Документы расходятся с фактами: REPOSITORIES.md называет `workspace`, `platform`, `inside-telegram` private, а на GitHub они **PUBLIC**. HARNESS.md не знает про `workshop-cases` (там стоит 0.4.7) и не отмечает, что Landing устарел. WORKFLOW утверждает, что «GitHub deletes the head branch after merge», но в `workshop-cases`, `inside-content`, `ai-engineering` опция `delete_branch_on_merge=false`. | medium |
| F9 | 5 dependabot PR Platform висят в `Review` больше 7 дней. Draft [platform#422](https://github.com/sachkov-inside/platform/pull/422) 16 дней в `In progress`, `CONFLICTING`, отстаёт на 88 коммитов. | medium |
| F10 | Локальный мусор: 4 worktree ai-engineering (3 ветки уже влиты), 57 влитых удалённых веток в ai-engineering, 7 висящих веток в Platform, старый detached worktree `worktrees/platform-telegram64-acceptance` (от 14.09, одна правка). | low |

## 1. Состояние досок

### 1.1 Project 1 «Inside — Developer Pipeline» (897 карточек, архивных 0)

Все шесть встроенных Project workflows выключены, как требует tracker-automation. Есть один view
`Current` (board, `is:issue is:open`).

| Тип / состояние | Inbox | Ready | In progress | Review | Blocked | Done |
|---|---|---|---|---|---|---|
| Issue OPEN (41) | 12 | 17 | 0 | 0 | 12 | 0 |
| Issue CLOSED (471) | — | — | — | — | — | 471 |
| PR OPEN (10) | — | — | 1 | 9 | — | — |
| PR MERGED (375) | — | — | — | — | — | 375 |

Закрытые, но не `Done`: 0. Открытые, но `Done`: 0. Влитые PR не в `Done`: 0. Закрытые без merge PR
на доске: 0. Проекция закрытия работает чисто.

Открытые issue по репозиториям: platform 30 (Ready 15, Blocked 8, Inbox 7); workspace 6; inside-telegram 2;
inside-content 2; inside-landing 1.

Priority и Area у открытых issue:

| Status | Now | Next | Later | пусто | Area пусто |
|---|---|---|---|---|---|
| Inbox (12) | 0 | 0 | 1 | 11 | 10 |
| Ready (17) | 0 | 0 | 6 | 11 | 12 |
| Blocked (12) | 0 | 4 | 7 | 1 | 1 |
| Всего (41) | **0** | 4 | 14 | **23** | **23** |

У закрытых issue Priority пустой у 157 (историческое, действий не требует).

Карточки в обоих Projects: **0**. `backlog:human` в Developer Pipeline: **0**. Открытые issue
организации, которых нет ни в одном Project: **0**. На досках нет только исторические PR, влитые до
rollout автоматизации: 17 в workspace, 10 в platform, 5 в telegram, 7 в landing. Действий не нужно.

### 1.2 Project 2 «Inside — Human Backlog» (11 карточек)

Поля: Status (`Todo`, `In Progress`, `Done`) и Priority. Поля Area нет, это соответствует документу.

| Issue | Status | Priority | Факт | Действие |
|---|---|---|---|---|
| [workspace#68](https://github.com/sachkov-inside/workspace/issues/68) MVP | Done | Now | закрыт 12.09, дочерние 4/5, открыт #72 | Владелец решает: отвязать #72 от #68, сделав его верхней целью, **или** переоткрыть #68 |
| [workspace#72](https://github.com/sachkov-inside/workspace/issues/72) Полноценный релиз | In Progress | Now | исполнение идёт через workspace#184 (сегодня выпуск v7/v8) | Оставить; закрыть после приёмки #184 |
| [workspace#118](https://github.com/sachkov-inside/workspace/issues/118) Telegram-воронки | In Progress | Next | нет дочерних; исполнение перенесено в #184 и telegram#45 (закрыт) | Добавить ссылку на #184 как delivery track или связать sub-issue |
| [workspace#146](https://github.com/sachkov-inside/workspace/issues/146) sachkov.dev | Todo | Next | дочерние inside-landing#29, platform#421 (оба Blocked) | Норма |
| [workspace#207](https://github.com/sachkov-inside/workspace/issues/207) Тесты в уроках | Todo | — | нет type | Поставить Priority и type |
| [workspace#208](https://github.com/sachkov-inside/workspace/issues/208) Проверка заданий практикума | Todo | — | нет type | Поставить Priority и type |
| [workspace#165](https://github.com/sachkov-inside/workspace/issues/165) | Done | — | закрыт | Можно оставить |

Замечание: Human Backlog issue служат native parent для delivery issue (#72 → #184, #146 → landing#29
и platform#421). Документы этого не запрещают, но и не описывают. Нужно одно предложение в WORKFLOW:
допустим ли такой parent, или связь только ссылкой.

### 1.3 Project 3 «Inside AI Engineering — подготовка запуска» (30 карточек)

У этой доски свой harness и своя политика. Встроенные Project workflows включены: auto-add, auto-close
и остальные. Полей Priority и Area нет. Открытых 20, из них In Progress 7 и Todo 13; Done 10. Map
[ai-engineering#2](https://github.com/sachkov-inside/ai-engineering/issues/2) открыт, дочерних 2/10.

Расхождения:

- `In Progress` при открытых blockers: [#6](https://github.com/sachkov-inside/ai-engineering/issues/6)
  (ждёт #31), [#7](https://github.com/sachkov-inside/ai-engineering/issues/7) (ждёт #6),
  [#9](https://github.com/sachkov-inside/ai-engineering/issues/9) (ждёт #6),
  [#12](https://github.com/sachkov-inside/ai-engineering/issues/12) (ждёт #11 и #7). Статуса Blocked
  на доске нет. Предложение: вернуть их в `Todo` или добавить значение `Blocked`.
- [#32](https://github.com/sachkov-inside/ai-engineering/issues/32) без меток.
- Ни у одного issue нет native type. Правило WORKFLOW распространяется только на Projects 1 и 2, но
  для единообразия его стоит принять и здесь.

### 1.4 Статус против фактов (Project 1)

| Карточка | Status | Факт | Предлагаемое действие |
|---|---|---|---|
| [platform#468](https://github.com/sachkov-inside/platform/issues/468) | Ready | PR #667, #669, #673 влиты 16–18.09; сессия `released`: «остаётся приёмка владельцем на стенде» | Поставить `ready-for-human` (→ Blocked) до приёмки, после приёмки закрыть. Сейчас агент увидит его как свободную задачу |
| [workspace#184](https://github.com/sachkov-inside/workspace/issues/184) | Blocked | активный выпуск сегодня (platform PR #686, #687, релизы v7/v8, Telegram v1); дочерние 1/1 закрыты | Норма по правилам (owner gate), но на доске не видно, что работа идёт. См. рекомендацию R2 |
| [platform#449](https://github.com/sachkov-inside/platform/issues/449) | Blocked | единственный native blocker #448 закрыт; последовательность «после релиза» задана решением владельца 11.09 и 15.09 | Записать blocker явно: `blocked_by` workspace#184 или `tracker:gate` |
| [platform#334](https://github.com/sachkov-inside/platform/issues/334), [#335](https://github.com/sachkov-inside/platform/issues/335) | Blocked | `needs-info`, blocker #333 закрыт 09.09; нет комментария о том, какая информация нужна; в теле `Priority: Next`, в Project `Later` | Повторный triage: снять `needs-info` и поставить `ready-for-agent` либо назвать недостающее решение. Согласовать Priority |
| [platform#652](https://github.com/sachkov-inside/platform/issues/652) | Blocked | `ready-for-human`, без Priority и Area, нет комментариев | Поставить Priority и Area, записать, какое решение человека нужно |
| [platform#421](https://github.com/sachkov-inside/platform/issues/421) + PR [#422](https://github.com/sachkov-inside/platform/pull/422) | Blocked / PR In progress | draft, 16 дней, `CONFLICTING`, отстаёт на 88 коммитов, проверяет удалённый `/library` | Владелец решает: закрыть #422 без merge и пересобрать после #184 (рекомендую) или оставить |
| [inside-landing#29](https://github.com/sachkov-inside/inside-landing/issues/29) | Blocked | репозиторий Landing устарел (0.4.7): «задачи и PR не ведутся»; нет readiness-метки | Перенести задачу в platform или workspace как часть #146 или закрыть как `not_planned` со ссылкой |

`In progress` дольше 14 дней без открытого PR: issue нет; есть PR #422 (выше). `Review` без
связанного открытого PR: issue нет.

### 1.5 Inbox (12, возраст 6–22 дня)

| Issue | Возраст, дн. | Метки | Type | Действие |
|---|---|---|---|---|
| [platform#245](https://github.com/sachkov-inside/platform/issues/245) observability | 22 | needs-triage, wayfinder:task | есть | Triage: Priority уже Later; решить readiness или закрыть |
| [inside-telegram#61](https://github.com/sachkov-inside/inside-telegram/issues/61) | 14 | needs-triage | есть | Triage; Area сейчас `Platform`, хотя это Telegram (см. R5) |
| [platform#634](https://github.com/sachkov-inside/platform/issues/634), [#644](https://github.com/sachkov-inside/platform/issues/644), [#646](https://github.com/sachkov-inside/platform/issues/646) | 9 | needs-triage | **нет** | Triage, type, Priority, Area |
| [platform#654](https://github.com/sachkov-inside/platform/issues/654), [#665](https://github.com/sachkov-inside/platform/issues/665) | 8–9 | needs-triage | есть | Triage, Priority, Area |
| [platform#636](https://github.com/sachkov-inside/platform/issues/636) | 9 | **нет меток** | **нет** | Поставить `needs-triage` и type |
| [workspace#194](https://github.com/sachkov-inside/workspace/issues/194) несвязывающий PR | 9 | needs-triage | есть | Triage первым: он закрывает F7 |
| [inside-telegram#75](https://github.com/sachkov-inside/inside-telegram/issues/75) | 8 | needs-triage | есть | Triage |
| [inside-content#9](https://github.com/sachkov-inside/inside-content/issues/9), [#10](https://github.com/sachkov-inside/inside-content/issues/10) | 6 | нет | **нет** | Content живёт по своей редакционной схеме; поставить type и решить, место ли им в Developer Pipeline (#10 — известное ограничение #468) |

### 1.6 Ready (17): у 11 нет Priority

[platform#534](https://github.com/sachkov-inside/platform/issues/534),
[#559](https://github.com/sachkov-inside/platform/issues/559),
[#569](https://github.com/sachkov-inside/platform/issues/569),
[#589](https://github.com/sachkov-inside/platform/issues/589),
[#605](https://github.com/sachkov-inside/platform/issues/605),
[#609](https://github.com/sachkov-inside/platform/issues/609),
[#610](https://github.com/sachkov-inside/platform/issues/610),
[#640](https://github.com/sachkov-inside/platform/issues/640) (type нет),
[#647](https://github.com/sachkov-inside/platform/issues/647) (type нет),
[workspace#173](https://github.com/sachkov-inside/workspace/issues/173),
[workspace#206](https://github.com/sachkov-inside/workspace/issues/206). Действие: владелец
расставляет Priority и Area за одну сессию triage. Большинство из них — отложенные находки ревью
по надёжности тестов и CI. [platform#519](https://github.com/sachkov-inside/platform/issues/519):
Priority есть, Area нет.

Дубль: [platform#490](https://github.com/sachkov-inside/platform/issues/490) «tiptap до 3.31.3» и
dependabot PR [platform#617](https://github.com/sachkov-inside/platform/pull/617) (тот же апгрейд).
Предложение: связать PR с issue (`Closes #490`) или закрыть одно из двух. Похожая пара:
[#491](https://github.com/sachkov-inside/platform/issues/491) (fastify/zod) и группы dependabot.

### 1.7 Метки readiness

- Больше одной readiness-роли: 0.
- Открытые delivery issue без роли: [platform#636](https://github.com/sachkov-inside/platform/issues/636),
  [platform#421](https://github.com/sachkov-inside/platform/issues/421),
  [inside-landing#29](https://github.com/sachkov-inside/inside-landing/issues/29),
  [platform#325](https://github.com/sachkov-inside/platform/issues/325) (агрегат Specification, только
  `tracker:gate`), inside-content#9 и #10.
- `ready-for-agent` при `Blocked`: #443 и #449. Это допустимо: блокирует native blocker.
- Закрытые с `needs-info`/`needs-triage`: 21 (например, platform#198–213, #446–456, workspace#148, #156).
  Это устаревшие метки на истории. Действие не обязательно.
- Метки `bug` и `enhancement` запрещены с 0.4.5; на открытых issue их нет, на закрытых 16 и 22.
  Можно удалить сами метки из репозиториев (low).

### 1.8 Иерархия и Wayfinder

- Открытые Specification без дочерних Tickets: 0. Единственный открытый Spec
  [platform#325](https://github.com/sachkov-inside/platform/issues/325) имеет 1/4 дочерних.
- Открытые родители, у которых все дочерние закрыты: [workspace#184](https://github.com/sachkov-inside/workspace/issues/184)
  (1/1). Это оправдано: идёт выпуск и приёмка.
- Открытый дочерний issue при закрытом родителе: [workspace#72](https://github.com/sachkov-inside/workspace/issues/72) → #68 (см. 1.2).
- Wayfinder maps в Pipeline: 7, все закрыты, все дочерние закрыты (workspace#38, #100, #111, #127, #156;
  platform#207, #230). Открытых maps нет. В AI Engineering открыт один map, #2 (2/10).

## 2. Поток за 60 дней (26.07–24.09.2026)

Все репозитории моложе 60 дней, поэтому окно покрывает почти всю историю.

| Repo | Issue открыто | Issue закрыто (completed/not_planned) | Открыто сейчас | PR влито | Закрыто без merge | Медиана open→merge, ч | p90, ч | PR открыты >7 дн. | CONFLICTING | Влито без `Closes` (из них dependabot) |
|---|---|---|---|---|---|---|---|---|---|---|
| workspace | 110 | 99 (90/8) | 11 | 85 | 1 | 0.2 | 6.2 | 0 | 0 | 26 (0) |
| platform | 377 | 347 (275/67) | 30 | 270 | 19 | 1.0 | 12.9 | 6: #422, #617, #618, #619, #621, #623 | 1: #422 | 37 (5) |
| inside-telegram | 40 | 38 (36/2) | 2 | 39 | 0 | 0.3 | 7.6 | 0 | 0 | 6 (0) |
| inside-landing | 9 | 8 (7/1) | 1 | 20 | 2 | 0.0 | 1.9 | 0 | 0 | 13 (0) |
| inside-content | 7 | 5 (4/1) | 2 | 3 | 0 | 0.2 | 0.2 | 0 | 0 | 0 |
| workshop-cases | 0 | 0 | 0 | 7 | 1 | 0.4 | 2.1 | 0 | 0 | 4 (0) |
| ai-engineering | 30 | 10 (10/0) | 20 | 57 | 0 | 0.0 | 0.0 | 0 | 0 | 49 (0; 48 с `N/A`) |

Выводы:

- Входящий поток issue почти равен закрытию. Хвост открытых небольшой (Platform 30), но плохо
  упорядочен (F1).
- PR вливаются почти сразу, медиана меньше часа. Узкое место не в review, а в triage и приёмке
  владельцем. Исключение — dependabot: 5 PR ждут 10 дней.
- `Closes` отсутствует у PR на ветках задач: platform #55, #203, #259, #284, #285, #459, #536, #584,
  #606, #667, #669, #673, #686, #687; workspace #24, #48, #88, #104, #107, #162, #167, #168, #191, #198;
  workshop-cases #2, #3. В основном это нарезка одного issue на несколько PR и cross-repo работа. Нужна
  явная норма в WORKFLOW (F7, workspace#194).
- В ai-engineering за 7 дней влито 57 PR с медианой 0 ч, по постоянному разрешению на merge
  (ai-engineering#23). Это осознанное локальное исключение, не нарушение Pipeline.

## 3. Документы Pipeline

Сверялись версии `origin/main` (0.4.7): AGENTS.md, WORKFLOW.md, docs/agents/issue-tracker.md,
triage-labels.md, tracker-automation.md, HARNESS.md, REPOSITORIES.md.

| # | Расхождение | Где | Рекомендация | Серьёзность |
|---|---|---|---|---|
| D1 | Требование `Closes #<issue>` и «один task — один PR» (WORKFLOW) против нормы «deliberately non-closing PR» (есть только в tracker-automation) и практики нескольких PR на один issue | WORKFLOW §Issues, tracker-automation §Agent sessions | Решить workspace#194; в WORKFLOW одной фразой описать несвязывающий PR (`Refs #`) и сослаться на tracker-automation | medium |
| D2 | Нет состояния «ждёт приёмки владельцем»: `ready-for-human` проецируется в `Blocked`, а выпущенная работа без сессии — в `Ready` | WORKFLOW Status, tracker-automation Facts | Задать правило: после merge, если нужна приёмка, ставить `ready-for-human` + комментарий «что принять», иначе закрывать. Либо добавить значение Status `Acceptance` | high |
| D3 | «GitHub deletes the head branch after merge» неверно для workshop-cases (harness 0.4.7), inside-content и ai-engineering (`delete_branch_on_merge=false`) | WORKFLOW §Issues | Включить настройку в workshop-cases (где действует WORKFLOW) или поправить текст | low |
| D4 | HARNESS.md перечисляет Workspace, Landing, Platform, Telegram; нет workshop-cases, не отмечен устаревший Landing; `health` на Landing падает by design | HARNESS.md | Обновить список; для устаревшего репозитория `health` должен сообщать статус, а не ошибку | low |
| D5 | Visibility в REPOSITORIES.md: `workspace`, `platform`, `inside-telegram` записаны private, фактически PUBLIC | REPOSITORIES.md | Владелец подтверждает, что так задумано, затем исправить таблицу. Если нет — это вопрос безопасности | medium (до подтверждения) |
| D6 | Значения Area (`Product`, `Platform`, `Landing`, `Operations`): нет Telegram и Content, а Landing устарел. Issue Telegram получают `Platform`, у Content Area нет вовсе | WORKFLOW Status/Priority/Area | Заменить на `Product`, `Platform`, `Telegram`, `Content`, `Operations` | low |
| D7 | Таблица маршрутизации в WORKFLOW не упоминает ai-engineering, inside-content, workshop-cases. Исключения описаны в REPOSITORIES.md и tracker-automation | WORKFLOW Routing | Добавить три строки со ссылкой на исключение | low |
| D8 | Правило про стадии и объём согласия дублируется в managed-блоке AGENTS.md и в WORKFLOW (Pipeline stages и Owner gates). Это противоречит собственному правилу Pruning «one authority per meaning» | AGENTS.md, WORKFLOW | Оставить в AGENTS.md только ссылку на WORKFLOW | low |
| D9 | Статусы Human Backlog (`Todo`, `In Progress`, `Done`) описаны только в tracker-automation; WORKFLOW описывает Status так, будто он общий | WORKFLOW Trackers | Одна строка в WORKFLOW | low |
| D10 | Human Backlog issue как native parent delivery issue нигде не описан | WORKFLOW Trackers | Явно разрешить или запретить | low |
| D11 | Owner gates понятны: merge, releases/deployments, product/visual, ADR, внешние записи, объём согласия. Неясно, кто и когда ставит Priority/Area: «during triage», но triage почти не идёт (F1) | WORKFLOW | Назначить регулярный triage владельца (например, еженедельно) или разрешить агенту предлагать Priority, чтобы владелец только подтверждал | medium |

Противоречий между triage-labels.md и issue-tracker.md нет: `backlog:human` без readiness описан
согласованно.

### Выравнивание harness

| Репозиторий | Локальный checkout | `origin/main` | health (package из `origin/main` 0.4.7) |
|---|---|---|---|
| workspace | 0.4.4, отстаёт на 16 коммитов | 0.4.7 | Healthy |
| platform | 0.4.7, отстаёт на 3 | 0.4.7 | **Ошибка: Duplicate ADR-0026** (`0026-guide-page-from-source-data.md`, `0026-web-navigation-and-caching.md`) |
| inside-telegram | 0.4.4, отстаёт на 9 | 0.4.7 | Healthy |
| workshop-cases | 0.4.4, отстаёт на 2 | 0.4.7 | Healthy |
| inside-landing | 0.4.4 | 0.4.4 (устарел, rollout не ведётся) | «Installed state differs» (ожидаемо) |
| inside-content, ai-engineering | свой harness, без `product-harness.json` | — | «Installed state differs» (ложная ошибка на чужом harness) |

Локальный `inside-harness health` из checkout Workspace (0.4.4) сообщает Healthy для
landing/telegram/workshop-cases и ошибку для platform. Причина — устаревший локальный Workspace, а не
состояние репозиториев. Рекомендация: fast-forward основного checkout (с согласия владельца), в Platform
перенумеровать один из ADR-0026 и добавить `inside-harness health` в CI Platform.

## 4. Локальный мусор (только отчёт, ничего не удалялось)

Worktrees:

| Путь | Ветка | Состояние | Предложение |
|---|---|---|---|
| repositories/ai-engineering-chapter-map | docs/6-first-three-chapters | PR #87 влит 24.09, чисто, не опубликованных коммитов нет | удалить worktree и ветку |
| repositories/ai-engineering-issue-31 | docs/12-authoring-and-first-chapter (имя папки не совпадает с веткой) | PR #86 влит 24.09, чисто | удалить |
| repositories/ai-engineering-issue-4 | research/4-entry-outcomes | PR #25 влит 20.09, чисто | удалить |
| repositories/ai-engineering-sdd-decision | docs/6-specifications-in-chapter-two | ветка запушена 24.09, PR нет — работа идёт | оставить |
| ~/orca/workspaces/.orca-preparing/32596-… (ai-engineering) | detached, locked | служебный worktree Orca | проверить, жив ли процесс Orca |
| ~/orca/workspaces/platform/koi | KirillSachkov/koi (c43d9e6f, влит как #674) | — | удалить, если Orca-сессия завершена |
| worktrees/platform-telegram64-acceptance | detached a663f661 (14.09) | 1 правка `apps/web/next-env.d.ts` (сгенерированный файл) | удалить |

Ветки:

- **ai-engineering**: на GitHub 57 удалённых веток, все влиты (кроме `docs/6-specifications-in-chapter-two`);
  `delete_branch_on_merge=false`. Локально 58 веток, из них влиты 57. Предложение: включить
  автоудаление веток и удалить влитые.
- **platform**, удалённые: `feat/614-guide-home-feed` (влита), `feat/202-ci-cd-course`,
  `feat/330-personal-home-data`, `feat/331-personal-home-proof`, `prototype/290-home-series-guide`
  (PR закрыты без merge), `prototype/guide-showcase`, `prototype/301-series-card-variants`,
  `prototype/311-navigation` (без PR). Локальные: влиты `feat/411-billing-storefront-account`,
  `feat/468-task-callout`, `feat/614-guide-home-feed`; PR закрыт без merge у `feat/330…`, `feat/331…`;
  без PR `prototype/380-guest-home-variants`, `prototype/guide-showcase`,
  `wip/material-authoring-http-before-account-sync` (01.09). Удаление прототипов требует решения владельца.
- **workshop-cases**, удалённые: `chore/harness-0.4.7`, `chore/tracker-readback-043`,
  `chore/357-tracker-rollout`, `chore/613-harness-0.4.6` (влиты), `chore/361-tracker-acceptance` (закрыт).
- **inside-content**, удалённые: `docs/6-agent-docs`, `feat/4-series-steps` (влиты).
- **inside-landing**, удалённая: `chore/30-harness-0.4.6` (PR закрыт).
- **workspace, telegram**: удалённых веток нет. В локальном workspace 3 влитые ветки
  (`docs/165-sales-frame`, `docs/170-legal-effective`, `fix/163-aggregate-status`); в его remote-tracking
  остались устаревшие ссылки (`prototype/102…`, `prototype/103…`, `docs/200…`, `docs/204…`), нужен `fetch --prune`.

Незакоммиченное в основных checkout (это состояние владельца, не трогать): workspace —
`REPOSITORIES.md` (M), `docs/research/2026-09-19-ai-engineering-course-survey.md`, `product/ai-engineering/`;
platform — 3 неотслеживаемых research-файла; telegram — `__pycache__` (добавить в `.gitignore`);
inside-content — `Начало.md` (M).

## 5. Рекомендации по порядку

1. **R1 (high).** Сессия triage владельца на 30 минут: Priority и Area для 23 открытых issue, хотя бы
   одно `Now`. Затем правило: `Ready` без Priority не выдаётся агенту (проверка в контроллере или в
   skill `triage`).
2. **R2 (high).** Ввести явное состояние приёмки (D2) и сразу применить к platform#468 и workspace#184.
3. **R3 (high).** Platform: перенумеровать ADR-0026, добавить `inside-harness health` в CI. Workspace:
   fast-forward локального `main` до 0.4.7.
4. **R4 (medium).** Проставить native type 10 открытым issue (workspace#207, #208; platform#634, #636,
   #640, #644, #646, #647; inside-content#9, #10). Для закрытых — по желанию, пакетно.
5. **R5 (medium).** Документы: решить workspace#194 (D1); обновить REPOSITORIES.md (visibility, D5),
   HARNESS.md (D4), значения Area (D6), маршрутизацию (D7).
6. **R6 (medium).** Hygiene: закрыть или пересобрать PR #422; решить судьбу inside-landing#29
   (Landing устарел); повторный triage #334/#335; явный blocker у #449; связать #617 с #490; разобрать
   5 dependabot PR (merge по разрешению владельца или закрыть).
7. **R7 (medium).** Human Backlog: #68/#72 (отвязать или переоткрыть), Priority у #207/#208,
   delivery-ссылка у #118.
8. **R8 (low).** Уборка: 3 влитых worktree ai-engineering, worktree platform-telegram64-acceptance,
   влитые ветки; включить `delete_branch_on_merge` в ai-engineering, workshop-cases и inside-content.
