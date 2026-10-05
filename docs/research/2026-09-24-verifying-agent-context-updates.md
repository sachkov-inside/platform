# Как проверять, что агент правильно обновил документацию и harness

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/2026-09-24-verifying-agent-context-updates.md); текущие правила — [документы Platform](../../README.md).

**Дата проверки:** 2026-09-24. **Статус:** исследовательские наблюдения и рекомендация для
обсуждения с владельцем, не принятое решение.

Это продолжение исследования
[«Знания агентов и расхождение документации с кодом»](2026-09-24-agent-knowledge-and-doc-drift.md).
Оно отвечает на его открытый вопрос 1. Что там уже разобрано, здесь не повторяется: карта
механизмов контекста, память runtime'ов, генерация с `--check`, линтеры ссылок, Danger,
spec-kit, хуки `Stop` как механизм, doc-gardening по расписанию.

Проверены статьи и документация вендоров, научные статьи на arXiv и классические источники
программной инженерии. Состояние Inside проверено по рабочей копии этой ветки
(`harness/packages/inside-engineering`, версия 0.4.7), по `platform` на коммите `6ce6b22f`
и по `ai-engineering` на коммите `11e03eb` (оба 2026-09-24). Все три открывались только на
чтение. У большинства страниц документации даты нет; для них указана дата проверки. Страницы
openai.com и developers.openai.com закрыты от автоматического чтения. Их цитаты сверены по
снимкам Wayback Machine, это отмечено у ссылки. Утверждения без первичного источника помечены
«не подтверждено». Выводы, которые не проверялись запуском агента, помечены «вывод, в runtime
не проверено».

## 1. Краткий ответ

Отчасти это evals, но не целиком. У задачи владельца две стороны, и индустрия называет их
по-разному.

**Первая сторона — одно конкретное изменение.** Заметил ли агент, что его правка затрагивает
документированное правило. Обновил ли он нужный документ. Не выдумал ли новое правило. В
программной инженерии это давно называется *change impact analysis* (анализ влияния
изменения) и *traceability* (прослеживаемость: связь требования с кодом, тестом и документом).
Проверяют это верификацией и ревью: детерминированными проверками в CI и независимым
проверяющим, человеком или агентом в чистом контексте. Это не evals. Evals меряют систему на
наборе задач, а не один PR.

**Вторая сторона — сам harness.** Действительно ли `AGENTS.md`, skills и `WORKFLOW.md`
заставляют агентов так себя вести. Вот это и есть evals: набор повторяемых сценариев,
несколько прогонов, grader'ы (проверяющие функции) и сравнение с прошлой версией. Anthropic,
OpenAI и GitHub описывают такие evals для skills и правил ревью. Исследования 2026 года
показывают, что без измерения полезность файлов контекста угадать нельзя.

Решение состоит из слоёв. Спецификация заранее называет, какие документы и правила меняются.
Агент в конце реализации сверяет фактическое влияние с заявленным. CI детерминированно ловит
то, что можно поймать машиной. Ревью в чистом контексте отдельно спрашивает про документы и
про новые правила. У каждого нового правила есть источник: решение владельца, спецификация или
ADR. Небольшой набор сценариев-фикстур проверяет, что сам harness даёт такое поведение. Его
запускают при выпуске новой версии harness, а не на каждом PR.

## 2. Карта понятий

### 2.1. Что проверяет каждое понятие

| Понятие | Что проверяет | Объект | Когда | Граница |
|---|---|---|---|---|
| **Offline evals** | Как часто система «агент + harness» решает задачи набора | распределение задач | до выпуска версии модели, промпта или harness | не говорит, верен ли конкретный PR |
| **Online evals, trace grading** | Качество реальных прогонов по их записи (trace) | поток реальных сессий | после прогонов | нужен сбор traces; Inside их сейчас не собирает |
| **Outcome vs trajectory** | Итоговое состояние среды или путь к нему | одна попытка | внутри eval | путь проверяют, когда важен процесс, например «сверился ли с документом» |
| **Grader: код / модель / человек** | Кто выносит оценку | результат или trace | внутри eval и ревью | код дешёв и точен, модель гибка и шумит, человек дорог и нужен для калибровки |
| **Verification в цикле агента** | Агент сам получает сигнал «прошло / не прошло»: тесты, `docs:check` | текущее изменение | во время работы | проверяет только то, что написано в проверке |
| **Review** | Независимая оценка diff по стандартам и требованиям | один PR | перед merge | зависит от того, что ревьюеру дали как эталон |
| **Change impact analysis** | Какие части системы и документы затронет изменение | одно изменение | до и в конце реализации | метод мышления, а не инструмент; качество зависит от карты связей |
| **Traceability** | Связь требования с кодом, тестом и документом в обе стороны | набор артефактов | всегда | ссылки нужно поддерживать, иначе они сами устаревают |
| **Context engineering, harness engineering** | Как устроен контекст, который видит агент | harness | при проектировании | дисциплина проектирования; её проверка — это evals |
| **Knowledge management, docs-as-code** | Где живёт каждый факт и кто им владеет | документы | всегда | разобрано в [предыдущем исследовании](2026-09-24-agent-knowledge-and-doc-drift.md) |

Определения evals взяты из статьи Anthropic «Demystifying evals for AI agents» (2026-01-09).
Task — «a single test with defined inputs and success criteria». Trial — одна попытка;
попыток несколько, «because model outputs vary between runs». Transcript «(also called a trace
or trajectory) is the complete record of a trial». Outcome — «the final state in the environment
at the end of the trial». Graders бывают трёх типов: «code-based, model-based, and human».
Capability evals начинаются с низкой доли успеха, а regression evals «should have a nearly 100%
pass rate».
[Anthropic](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

Change impact analysis по SWEBOK v3 (глава 5, раздел 2.1.3) — это анализ, который «identifies
all systems and software products affected by a software change request and develops an
estimate of the resources needed to accomplish the change». Там же: «Software designed with
maintainability in mind greatly facilitates impact analysis»
([копия главы](https://mireilleblayfornarino.i3s.unice.fr/lib/exe/fetch.php?media=teaching%3Areverse%3Aswebokv3_-_chap5_-_code_maintenance.pdf)).
Traceability по Gotel и Finkelstein (ICRE 1994) — «the ability to describe and follow the life
of a requirement, in both a forwards and backwards direction»
([PDF](http://discovery.ucl.ac.uk/749/1/2.2_rtprob.pdf)).

### 2.2. Где граница между verification, review и evals

Главное различие — объект проверки.

- **Verification и review** отвечают на вопрос «правильно ли это изменение». Результат —
  решение по одному PR: пропустить, исправить, отклонить.
- **Evals** отвечают на вопрос «правильно ли ведёт себя система на классе задач». Результат —
  доля успеха и её изменение между версиями. Исправляют по нему harness, а не PR.

Evals нужны и для тех, кто проверяет. Если ревью делает агент, его точность — тоже свойство
системы. Spotify использует LLM-судью, который сравнивает diff с исходной задачей. Судья
отклоняет около четверти сессий, и агент исправляется примерно в половине случаев. Но авторы
пишут прямо: «We have yet to invest in evals for our judge»
([Spotify, 2025-12-09](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3)).
Значит, без evals нельзя сказать, как часто судья ошибается.

Сводка по вопросам владельца:

| Вопрос | Основная дисциплина | Evals нужны? |
|---|---|---|
| (а) Заметил ли агент влияние на документированное правило | change impact analysis, traceability, review | для проверки проверяющего |
| (б) Обновил ли правильный документ | docs-as-code, детерминированные проверки, review | для проверки проверяющего |
| (в) Не выдумал ли правило и не записал ли неверное | review, provenance (происхождение правила), owner gate | для проверки проверяющего |
| (г) Даёт ли harness нужное поведение | evals harness, skills и правил ревью | да, это их прямая задача |

### 2.3. Что уже есть в материалах Inside

Исследования репозитория `ai-engineering` (курс) разбирали эту тему. Их выводы совпадают с
разделением выше.

- **Контроль обновления документов там ведут как documentation maintenance, а не как evals.**
  Опора — ревью по двум осям, раздел про влияние на документацию в PR, детерминированный
  `docs:check` и проверка новой сессией. Документация GitLab рекомендует класть документы в тот
  же merge request, что и код, а за техническую точность отвечает автор, в том числе за
  AI-тексты (`ai-engineering/docs/research/2026-09-22-documentation-and-retrieval.md`, строки
  23–49, [GitLab](https://docs.gitlab.com/development/documentation/workflow/)). Там же
  различены два вида устаревания: индекс против источника и документ против кода (строки
  92–93).
- **Evals там — обратное направление: «помогла ли правка harness».** Это «эвалы рабочего
  процесса» из каталога Мокевнина: изменения harness сравнивают на стабильных задачах с учётом
  результата и хода работы (`2026-09-22-agentic-design-patterns.md`, строки 44, 94–117;
  [глава](https://mokevnin.github.io/agentic-coding-design-patterns/ru/agent-workflow-evals.html)).
  Предложен цикл: потребность → правка правила → повтор задачи → проверка эффекта, включая
  удаление правила. Периодический пересмотр там предпочтён автоматическому добавлению правил.
  Главу в этом исследовании заново не читал.
- **Отдельный проверяющий.** Разбор arXiv 2609.01481 (Harness-of-Harness): QA проверяет
  замороженную версию только на чтение, «наличие кода не считается проверкой поведения»,
  а отчёт исполнителя и приёмка — разные свидетельства
  (`2026-09-24-harness-of-harness.md`, строки 51–60, 163–169).
- **Уровни проверки harness.** Stored, Wired и Healthy проверяются командами. Advertised и
  Invoked (агент увидел skill и вызвал его) — только новой сессией (`docs/harness.md`,
  строки 48–50).
- **Ручной eval ревью-skill.** Для `content-review` проводили сухой прогон на искусственно
  испорченном фрагменте и сверяли, какие дефекты найдены (`docs/content-harness.md`, строки
  82–89). Это тот же приём, что «известные нарушения и безопасные контрпримеры» у OpenAI
  (раздел 4.1).
- **Агент документации отложен.** Решение от 22.09.2026 не фиксирует ни обязательного
  docs-агента, ни отказа от него (`docs/decisions.md`, строки 362–372).

Пробелы в тех материалах: нет eval'а вида «изменение X → ожидаемое обновление документа Y»,
нет grader'а синхронизации документации, не используются термины change impact analysis и
traceability, нет процедуры продвижения уроков сессии. Последний пункт закрывает предыдущее
исследование, остальные — это.

## 3. Практики по классам проблем

«Зрелость» — насколько практика устоялась на 2026-09. «Стоимость» — оценка внедрения для
Inside: низкая — часы, средняя — дни, высокая — постоянное сопровождение.

### 3.1. (а) Агент заметил, что изменение затрагивает документированное поведение

Исследования показывают, почему это не происходит само. Gao и Chen изучили 557 сессий агентов
и 33 097 агентных PR. Среди многокоммитных PR, где меняются и код, и документация, код
трогают первым в 4,7 раза чаще. Явной последовательности «сверить результат с документацией»
в поведении агентов не нашли: «no explicit documentation-based validation sequence was
observed» ([arXiv 2608.20195](https://arxiv.org/abs/2608.20195), 2026-08-20). McMillan на
1 650 сессиях Claude Code показал, что соблюдение правил падает по ходу сессии: каждая новая
функция снижает шансы соблюдения примерно на 5,6% (OR = 0,944)
([arXiv 2605.10039](https://arxiv.org/abs/2605.10039), 2026-05-11). RepoComplianceBench: агенты
«almost never proactively retrieve the contribution rules», если правила лежат вне контекста
([arXiv 2607.26819](https://arxiv.org/abs/2607.26819), 2026-07-29). Вывод: сверка с
документами должна быть явным шагом в конце работы, а не надеждой на внимательность.

| Практика | Что ловит | Что не ловит | Зрелость | Стоимость | Источник |
|---|---|---|---|---|---|
| Заявить влияние в спецификации | известное заранее влияние; даёт ревью эталон | влияние, найденное только при реализации | идея traceability устоялась с 1994 | низкая | [Gotel, Finkelstein](http://discovery.ucl.ac.uk/749/1/2.2_rtprob.pdf) |
| Шаг сверки в конце реализации: перечислить изменённые долговечные факты | большую часть пропусков; ставит сверку после кода, где она и нужна | факты, которые агент не считает фактами | в `platform` уже есть как контракт | низкая | `platform/docs/agents/documentation-maintenance.md`; [Mintlify](https://www.mintlify.com/docs/guides/use-automations) |
| Ревью с явным вопросом о документах | устаревшие утверждения в документах после изменения кода | то, чего ревьюер не видит в diff и не знает | Google — давно; Claude Code Review — research preview | низкая | [Google](https://google.github.io/eng-practices/review/reviewer/looking-for.html), [Claude Code Review](https://code.claude.com/docs/en/code-review) |
| Закреплённые факты в `docs:check` | возврат устаревшего термина или решения | новые факты, которых ещё нет в проверке | в `platform` уже есть | низкая на каждый факт | `platform/scripts/check-agent-documentation.mjs` |
| Поиск устаревших ссылок на элементы кода | упоминания удалённых классов и функций в документах | смысловое устаревание | исследовательский инструмент (2023) | средняя | [arXiv 2307.04291](https://arxiv.org/abs/2307.04291) |

**Процедура сверки у Mintlify.** Руководство по автоматизациям Mintlify даёт образец для
триггера «изменился код»: «1. Read the merged pull request diff from the trigger repository.
2. Identify any changed API endpoints, parameters, or response shapes. 3. Search the
documentation for pages that reference those endpoints. 4. Update the affected pages to match
the changes in the pull request. 5. Open a pull request with a summary of the pages you changed
and why.» Для правок, меняющих смысл, рекомендуется режим «Modify and wait for review»
([Mintlify automations](https://www.mintlify.com/docs/guides/use-automations); дата не указана).
Это та же последовательность, что в контракте `platform`: «Inspect the diff and list every
changed durable fact», затем обновить каждый факт в одном авторитетном источнике.

**Ревью, которое проверяет документы в обе стороны.** Google: «If a CL changes how users
build, test, interact with, or release code, check to see that it also updates associated
documentation… If documentation is missing, ask for it.»
([Google eng-practices](https://google.github.io/eng-practices/review/reviewer/looking-for.html)).
Claude Code Review читает `CLAUDE.md` репозитория, и «This works bidirectionally: if your PR
changes code in a way that makes a `CLAUDE.md` statement outdated, Claude flags that the docs
need updating too». Продукт в research preview, только для Team и Enterprise; локальная
команда `/code-review` доступна на других планах
([Claude Code Review](https://code.claude.com/docs/en/code-review)). Codex в GitHub «searches
your repository for AGENTS.md files and follows any Review guidelines you include»
([Codex GitHub; цитата по снимку Wayback от 2026-07-08](https://developers.openai.com/codex/integrations/github)).
Copilot code review читает `AGENTS.md` и instructions с head-ветки PR, «so you can test changes
to them in the same pull request without merging them first»
([GitHub](https://docs.github.com/en/copilot/tutorials/customize-code-review)).

### 3.2. (б) Агент обновил правильный документ

| Практика | Что ловит | Что не ловит | Зрелость | Стоимость | Источник |
|---|---|---|---|---|---|
| Таблица «вид факта → авторитетный документ» | факт записан не туда или в два места | неверное содержание в правильном месте | в `platform` уже есть | низкая | `documentation-maintenance.md` → `Choose the authority` |
| Ось Standards читает эту таблицу как стандарт | нарушение таблицы в diff | то же | вывод, в runtime не проверено | низкая | `code-review` → шаг 3 «standards sources» |
| Детерминированные проверки: указатели, ADR-статусы, `--check` | битые ссылки, отставшие сгенерированные файлы, неверный статус ADR | смысл | зрелые | уже есть | [предыдущее исследование](2026-09-24-agent-knowledge-and-doc-drift.md), раздел 3 |
| Раздел отчёта «Изменения документации» с явным «None» | молчаливый пропуск: автор обязан сказать, почему документы не нужны | неверное объяснение | уже есть | уже есть | PR-шаблон; `platform`: «None — code/schema/tests are the authority» |
| Сообщения проверок с инструкцией по исправлению | агент сам чинит ошибку по тексту проверки | — | практика OpenAI | низкая | [OpenAI harness engineering](https://web.archive.org/web/20260913183535/https://openai.com/index/harness-engineering/) |

OpenAI в статье о harness engineering пишет: «Because the lints are custom, we write the error
messages to inject remediation instructions into agent context.» Там же: «A single blob doesn't
lend itself to mechanical checks (coverage, freshness, ownership, cross-links), so drift is
inevitable.» Сообщения `platform` `docs:check` уже устроены так: каждое называет причину,
например «route Materials changes through the current mutable-model ADR».

### 3.3. (в) Агент не выдумал правило и не записал неверное

Это самый трудный класс. Детерминированно его почти не поймать. Правдоподобное, но
неподтверждённое правило выглядит как обычный текст. Поэтому здесь работают три идеи:
происхождение правила, разделение автора и проверяющего и owner gate.

| Практика | Что ловит | Что не ловит | Зрелость | Стоимость | Источник |
|---|---|---|---|---|---|
| **Provenance:** у каждого нового или изменённого нормативного правила есть источник | правило «из воздуха»; обобщение одного случая | неверно понятое решение с настоящей ссылкой | идея traceability; в агентных процессах — предложение | низкая | Gotel, Finkelstein; Inside `Review closure` |
| Ось Spec: нормативный текст без источника в спецификации = выход за рамки | выдуманные правила в документах, так же как лишний код | правило, которое вписано и в спецификацию | как проверка кода зрелая; для документов — вывод | низкая | `code-review` → Spec (b) «scope creep»; [Spotify](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3) |
| Проверка утверждений документа против кода | утверждение о поведении, которого в коде нет | правило процесса, которого в коде нет по природе | Claude Code Review делает шаг verification | средняя | [Claude Code Review](https://code.claude.com/docs/en/code-review) |
| Автор ≠ проверяющий, чистый контекст | предвзятость автора к своему тексту | общая слепая зона одной модели | рекомендация вендора | низкая | [Claude Code best practices](https://code.claude.com/docs/en/best-practices) |
| Новое правило процесса — решение владельца в разделе «Решения владельца» | закрепление правила без согласия | — | правило Inside (owner gates) частично | низкая | `WORKFLOW.md` → `Owner gates` |

**Почему выдуманное правило — это выход за рамки.** Ось Spec в `code-review` уже ищет
«behaviour in the diff that wasn't asked for (scope creep)». Правило в `AGENTS.md`,
`CODING_STANDARDS.md` или `WORKFLOW.md` — тоже поведение, только агентов. Если спецификация
или решение владельца его не просили, это тот же выход за рамки. Spotify использует судью как
раз для такого класса: он не даёт агенту быть «too ambitious, trying to solve problems that
weren't strictly in their prompt, like refactoring code or disabling flaky tests»
([Spotify](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3)).
В `ai-engineering` та же мысль для требований: существенное изменение требований согласуется,
«а не подгоняется молча под уже полученный код»
(`2026-09-24-spec-first-from-chapter-one.md`, строки 76–78).

**Автор и проверяющий.** Claude Code best practices: «a fresh model try to refute the result,
so the agent doing the work isn't the one grading it» и «A fresh context improves code review
since Claude won't be biased toward code it just wrote». Там же предупреждение о лишних
находках: «A reviewer prompted to find gaps will usually report some, even when the work is
sound… Tell the reviewer to flag only gaps that affect correctness or the stated requirements»
([best practices](https://code.claude.com/docs/en/best-practices)). `code-review` Inside уже
запускает оси в отдельных субагентах.

**Ограничения LLM-судьи.** Судьи смещены по позиции, длине ответа и в пользу своих ответов:
«position, verbosity, and self-enhancement biases»
([Zheng et al., arXiv 2306.05685](https://arxiv.org/abs/2306.05685), 2023). На задачах с кодом
«all models still exhibit significant randomness in their judgment»
([CodeJudgeBench, arXiv 2507.10535](https://arxiv.org/abs/2507.10535), 2025). Агенты-ревьюеры
вместе решают только около 40% задач бенчмарка c-CRAB и «often consider different aspects from
the human reviews» ([arXiv 2603.23448](https://arxiv.org/abs/2603.23448), 2026). Проверка по
чек-листу и траектории согласуется с людьми лучше одного вердикта: Agent-as-a-Judge — 90%
против 70% у LLM-as-a-Judge ([arXiv 2410.10934](https://arxiv.org/abs/2410.10934), 2024).
Вывод: судья для класса (в) полезен как сигнал, но окончательное решение о новом правиле
остаётся за владельцем.

**Прошедшие проверки не доказывают правильность.** В SWE-bench 7,8% патчей засчитаны как
верные, хотя не проходят полный набор тестов разработчиков, а 29,6% правдоподобных патчей
ведут себя иначе, чем эталон ([PatchDiff, arXiv 2503.15223](https://arxiv.org/abs/2503.15223)).
UTBoost нашёл 345 ошибочных патчей, помеченных как прошедшие
([arXiv 2506.09289](https://arxiv.org/abs/2506.09289)). Для документации то же: зелёный
`docs:check` говорит, что ссылки живы и закреплённые факты на месте, но не говорит, что новый
текст верен.

### 3.4. (г) Harness сам по себе даёт нужное поведение

Здесь нужны evals, подробно — в разделе 4. Коротко о зрелости:

| Практика | Что даёт | Зрелость | Стоимость | Источник |
|---|---|---|---|---|
| Сравнение «со skill / без skill» в свежей сессии | видно, помогает ли skill вообще | официальная рекомендация Anthropic | низкая вручную | [Claude Code skills](https://code.claude.com/docs/en/skills) |
| `claude plugin eval` | набор случаев, 3 прогона, grader'ы, Δ против прогона без плагина, код выхода для CI | новый (сентябрь 2026), только Claude Code | средняя | [plugin evals](https://code.claude.com/docs/en/plugin-evals) |
| skill-creator benchmark | pass rate, время, токены со skill и без; слепое A/B двух версий | публичный skill Anthropic | средняя | [skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) |
| Evals skill по OpenAI: явный, неявный, контекстный вызов и negative control | ловит лишние и пропущенные срабатывания | блог-руководство (январь 2026) | средняя | [OpenAI eval-skills](https://developers.openai.com/blog/eval-skills) |
| Eval правил ревью: нарушения, безопасные контрпримеры, посторонние изменения | меряет, ловит ли ревьюер нарушения правил и молчит ли без них | блог OpenAI (июль 2026) | средняя | [OpenAI custom review rules](https://web.archive.org/web/20260827213557/https://developers.openai.com/blog/custom-code-review-rules-for-codex) |
| `gh aw trial` | прогон agentic workflow во временном приватном репозитории | public preview | средняя | [gh-aw CLI](https://github.github.com/gh-aw/setup/cli/) |
| Пилотный репозиторий при выпуске harness | качественная проверка на одном репозитории | уже есть в Inside | низкая | `SOURCE.md` → «test a pilot repository» |

## 4. Evals для самого harness

### 4.1. Что говорят вендоры

**Anthropic.** «Demystifying evals for AI agents» (2026-01-09) даёт основу. Начинать с малого:
«20-50 simple tasks drawn from real failures is a great start». Каждая попытка «should be
"isolated" by starting from a clean environment». Хорошая задача — та, где «two domain experts
would independently reach the same pass/fail verdict». Оценивать лучше результат: «it's often
better to grade what the agent produced, not the path it took». Про надёжность: при 75% успеха
на попытку все три попытки проходят лишь в 42% случаев; «pass^k for agents where consistency is
essential». Про grader'ы: «You won't know if your graders are working well unless you read the
transcripts and grades from many trials»
([статья](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).

Pass^k — доля задач, где успешны все k попыток. Термин введён в τ-bench: «the chance that all k
i.i.d. task trials are successful, averaged across tasks»
([arXiv 2406.12045](https://arxiv.org/abs/2406.12045), 2024). Для правила «никогда не выдумывать
правило» подходит именно pass^k, а не среднее.

Про skills Anthropic пишет «Start with evaluation»: сначала найти пробелы агента на
представительных задачах, потом строить skill
([Agent Skills, 2025-10-16](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)).
Документация skills Claude Code разделяет два вопроса: «Seeing a skill trigger tells you Claude
found it, not that it did what you intended». Рецепт: несколько реальных запросов, каждый в
свежей сессии со skill и без. Свежая сессия важна, «because leftover context from authoring
the skill will mask gaps in the written instructions»
([skills](https://code.claude.com/docs/en/skills)). Best practices про `CLAUDE.md`: «test changes
by observing whether Claude's behavior actually shifts»
([best practices](https://code.claude.com/docs/en/best-practices)).

`claude plugin eval` появился в Claude Code в сентябре 2026. Случай — это запрос плюс
grader'ы. Каждый случай по умолчанию идёт три раза: «One run of a non-deterministic agent tells
you little». Второй набор прогонов идёт без плагина, и разница `Δ` показывает вклад плагина.
Рекомендуется один grader на результат и один на путь. Шесть типов grader'ов: `regex`,
`tool_used`, `tool_order`, `file_exists` — бесплатные; `llm` и `baseline` вызывают судью.
Для длинного результата советуют `regex` по файлу, а `llm` — для коротких ответов с
PASS/FAIL-условиями. Код выхода 1 при провале порога, есть режим для CI
([plugin evals](https://code.claude.com/docs/en/plugin-evals)). Ограничение для Inside: каждый
прогон идёт в пустом каталоге, и «Nothing personal or project-level loads… `CLAUDE.md` files…
and skills are absent». Инструмент меряет плагин, а не harness репозитория. Загрузится ли
`AGENTS.md` или `CLAUDE.md`, созданный `scaffold_script` внутри рабочего каталога прогона, —
**не подтверждено**.

skill-creator советует проверяемые утверждения и предупреждает о бесполезных: «assertions that
always pass regardless of skill (non-discriminating), high-variance evals (possibly flaky)».
Субъективное качество лучше оценивать качественно: «don't force assertions onto things that
need human judgment». Для подбора описания skill набор делится на 60% обучения и 40%
отложенной проверки
([skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)).
Анонс от 2026-03-03 добавляет: если базовая модель начинает проходить evals без skill, приёмы
skill, возможно, уже вошли в модель
([блог Claude](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills)).
То есть evals помогают и удалять правила, а не только добавлять.

**OpenAI.** «Testing Agent Skills Systematically with Evals» (2026-01-22): «an eval is: a prompt
→ a captured run (trace + artifacts) → a small set of checks → a score you can compare over
time». Набор запросов включает явный, неявный и контекстный вызов и negative control:
«Including at least one should_trigger=false case helps catch false positives». Trace снимают
через `codex exec --json`, форму оценки задают через `--output-schema`. Правило роста набора:
«Let real failures drive coverage. Every manual fix is a signal. Turn it into a test»
([статья](https://developers.openai.com/blog/eval-skills); цитаты по снимку Wayback от 2026-09-21).
Разбор в `ai-engineering` отмечает слабое место примера: он засчитывает появление команды в
событиях и наличие файла. Это не доказывает успешный код выхода и то, что файл создан именно
этим запуском (`2026-09-22-learning-coding-harness.md`, строки 43–46).

«Custom Code Review rules for Codex» (2026-07-20) — единственный найденный замер того, как
правила репозитория меняют поведение ревьюера. Набор содержал «known rule violations and safe
counterexamples». С правилами ревьюер нашёл 98% нужных замечаний, без них — 58,3%. Критерии:
«Coverage», «Restraint», «Retention», «Actionability». Минимальный тест правила: «one change
that should trigger the rule, one safe counterexample, and one unrelated change». И граница:
«tests, branch protections, and required approvals continue to provide hard enforcement»
([снимок Wayback 2026-08-27](https://web.archive.org/web/20260827213557/https://developers.openai.com/blog/custom-code-review-rules-for-codex)).

Руководство «Evaluate agent workflows» описывает переход от отдельных traces к наборам:
«Once you know what "good" looks like, move from individual traces to repeatable datasets and
eval runs» ([руководство; цитата по снимку Wayback от 2026-09-20](https://developers.openai.com/api/docs/guides/agent-evals)).
Строки о превращении упавшего trace в регрессионный случай на странице нет — **не
подтверждено**; в `ai-engineering` это было предложением для Inside, а не цитатой. Важно для
выбора инструмента: платформа OpenAI Evals выводится из эксплуатации. 2026-10-31 существующие
evals станут только для чтения, 2026-11-30 dashboard и API закроются. Предлагаемая миграция —
Promptfoo ([deprecations; по снимку Wayback от 2026-09-23](https://developers.openai.com/api/docs/deprecations)).
Методика из «Evaluation best practices» от этого не зависит: «Set up continuous evaluation (CE)
to run evals on every change» и предупреждение против «Vibe-based evals»
([руководство](https://developers.openai.com/api/docs/guides/evaluation-best-practices)).

**GitHub.** Про custom instructions для Copilot code review: «Begin with 10–20 specific
instructions… then test whether these are influencing Copilot code review in the way you
intended» ([GitHub](https://docs.github.com/en/copilot/tutorials/customize-code-review)). Для
agentic workflows есть `gh aw trial`: «Test workflows in temporary private repositories»
с `--repeat` ([gh-aw CLI](https://github.github.com/gh-aw/setup/cli/)). Качество
«Daily Documentation Updater» GitHub оценивает по доле принятых PR: 57 из 59
([gh-aw блог, 2026-01-13](https://github.github.com/gh-aw/blog/2026-01-13-meet-the-workflows-documentation/)).
Это онлайн-метрика, а не eval.

### 4.2. Что говорят исследования

| Работа | Что измерено | Вывод для Inside |
|---|---|---|
| Gloaguen et al., [arXiv 2602.11988](https://arxiv.org/abs/2602.11988), v2 2026-06-23 | 138 задач из 12 репозиториев с файлами контекста + SWE-bench | файлы контекста «does not generally improve task success rates, while increasing inference cost by over 20%»; инструкции агенты выполняют, а обзоры репозитория не помогают; «any attempts to improve performance should be rigorously evaluated before deployment» |
| Lulla et al., [arXiv 2601.20404](https://arxiv.org/abs/2601.20404), 2026-01-28 | 10 репозиториев, 124 PR | с `AGENTS.md` медианное время меньше на 28,64%, выходных токенов — на 16,58%, выполнение задач сопоставимо |
| Khatri, [arXiv 2607.27250](https://arxiv.org/abs/2607.27250), 2026-07-28 | 288 прогонов Claude Code и Codex | стратегия контекста не сдвигает корректность измеримо (граница ≤ 10–15 п.п.) |
| McMillan, [arXiv 2605.10039](https://arxiv.org/abs/2605.10039), 2026-05-11 | 1 650 сессий Claude Code | структура файла на соблюдение не влияет; соблюдение падает по ходу сессии |
| OctoBench, [arXiv 2601.10343](https://arxiv.org/abs/2601.10343), ACL 2026 | 217 задач, 7 098 пунктов чек-листа по траекториям | «a systematic gap between task-solving and scaffold-aware compliance» |
| RepoComplianceBench, [arXiv 2607.26819](https://arxiv.org/abs/2607.26819), 2026-07-29 | 106 задач из 49 репозиториев | правила вне контекста агенты сами не ищут; напоминания и обратная связь проверяющего помогают |
| Gao, Chen, [arXiv 2608.20195](https://arxiv.org/abs/2608.20195), 2026-08-20 | 557 сессий, 33 097 PR | 60,5% обращений к документации — к инструкциям агентов; документация отстаёт от кода |

Общий вывод исследований. Агенты в целом выполняют конкретные инструкции из файла контекста.
Но польза для итогового результата мала и не гарантирована, а стоимость растёт. Значит, правку
harness нельзя считать полезной, пока её не измерили. И лишнее правило стоит денег в каждой
сессии. Это прямой довод за evals самого harness и за `Pruning`.

### 4.3. Фикстурный набор «изменение → ожидаемые обновления» для Inside

Это предложение исследования, собранное из источников выше. Готового вендорского инструмента
именно для этой задачи не найдено.

**Фикстура.** Маленький репозиторий с установленным harness Inside. В нём есть
`AGENTS.md`, `CONTEXT.md`, два-три ADR (одно заменено другим), продуктовый brief, контракт
`docs/agents/documentation-maintenance.md` с таблицей авторитетов, `CODING_STANDARDS.md`,
немного кода с тестами и скрипт вроде `docs:check`. Фикстура хранит начальный коммит. Каждый
прогон начинается с чистой копии.

**Случай.** Задача в виде тикета + ожидания. Примеры:

| # | Сценарий | Ожидаемый результат | Grader |
|---|---|---|---|
| 1 | Бизнес-правило меняется: пробный период 7 → 14 дней, brief говорит «7 дней» | brief обновлён; старое значение исчезло; accepted ADR не тронут | код: список файлов в `git diff`, `regex` по brief, `docs:check` |
| 2 | Переименование доменного термина | `CONTEXT.md` обновлён; старый термин отсутствует в текущих документах; указатели живы | код: `regex`, `docs:check` |
| 3 | Новое решение заменяет ADR | новый ADR, старый — `superseded by`; история не переписана | код: `inside-harness health` или аналог |
| 4 | Изменилась команда проверки | `AGENTS.md` называет новый скрипт; скрипт есть в `package.json` | код |
| 5 | **Контроль:** рефакторинг без изменения поведения | прозаические документы не тронуты; в отчёте «None — code/schema/tests are the authority» | код: пустой diff документов + `regex` по отчёту |
| 6 | **Ловушка «выдуманное правило»:** исправление ошибки наводит на общее правило, но спецификация его не даёт | `AGENTS.md`, `CODING_STANDARDS.md`, `WORKFLOW.md` не изменены, либо правило вынесено в «Решения владельца» как предложение | код: diff этих файлов; модель: PASS/FAIL-рубрика по отчёту |
| 7 | Ревью: diff меняет поведение, документ не обновлён | `code-review` сообщает о пропущенном документе | модель + `regex` по отчёту ревью |
| 8 | Ревью: тот же diff с правильным обновлением документа | замечания о документах нет | то же |
| 9 | Ревью: постороннее изменение | замечания о документах нет | то же |

Случаи 7–9 повторяют схему OpenAI «нарушение / безопасный контрпример / постороннее
изменение» и ручной прогон `content-review` из `ai-engineering`. Случаи 5 и 6 проверяют
сдержанность: агент не должен править документы, когда это не нужно.

**Grader'ы по порядку.** Сначала код: какие файлы изменены и какие нет, `regex` на обязательные
и запрещённые формулировки, код выхода `docs:check` и `health`. Затем модель — только для
смысла: «у каждого нового нормативного утверждения есть источник», с конкретными условиями
PASS и FAIL. Человек — на калибровке: владелец читает записи первых прогонов и сверяет их с
оценками grader'ов. Если grader и владелец расходятся, чинят grader, а не harness.

**Прогоны и метрика.** Три прогона на случай, как в `claude plugin eval`. Для случаев 5, 6, 8 и
9 (сдержанность, запреты) — pass^3: все три должны пройти. Для остальных — доля успешных
прогонов. Сравнивается новая версия harness с прошлой, а не «с harness и без»: вопрос владельца —
помогла ли правка.

**Когда запускать.** При выпуске новой версии canonical package, рядом с нынешним шагом
«test a pilot repository» из `SOURCE.md`. И после реального промаха: промах становится новым
случаем, как советуют Anthropic и OpenAI. Не на каждом PR: это десятки агентных прогонов.
Для оценки: 9 случаев × 3 прогона × 2 версии = 54 прогона одного runtime на выпуск.

**Runtime.** Harness Inside обслуживает Claude Code, Codex, Kimi и OpenCode. Самый переносимый
путь — свой скрипт-раннер, который запускает headless CLI (`claude -p`, `codex exec --json`) в
копии фикстуры и затем применяет grader'ы к diff и отчёту. `claude plugin eval` подходит для
отдельных skills, но изолирует прогон от `CLAUDE.md` и skills проекта. Платформа OpenAI Evals
закрывается в ноябре 2026. Promptfoo как общий раннер в этом исследовании не проверялся.
(Вывод, в runtime не проверено.)

### 4.4. Ограничения evals harness

- Набор отвечает только на вопросы, которые в нём есть. Новый класс ошибок он не найдёт.
- Модель-судья сама требует проверки. Пример Spotify показывает, что это легко отложить.
- Маленький набор шумит. Разница в один прогон из трёх — не доказательство улучшения.
- Набор может «переобучить» harness под себя. Anthropic и skill-creator советуют отложенную
  часть набора, которую не используют при правке.
- Фикстура не заменяет реальный репозиторий. Пилот на `platform` остаётся.

## 5. Как это ложится на pipeline Inside

| Этап | Уже есть | Чего нет |
|---|---|---|
| Sharpen (`grilling`) | уточнение решений владельца; `domain.md` ведёт к документу-владельцу | — |
| Specification (`to-spec`) | шаблон: Implementation Decisions, Testing Decisions, Out of Scope; ADR учитываются | раздел «Документы и правила»: какие долговечные факты меняются, в каком авторитетном документе, какие правила новые и чьё это решение. Без путей к файлам — шаблон их запрещает |
| Tickets (`to-tickets`) | критерии приёмки; сквозные срезы | критерий приёмки «обновлён документ X», когда тикет меняет заявленный факт; какой тикет отвечает за общие документы |
| Implementation (`implement`) | `Ready and Done`: «durable documents and ADRs are updated when a confirmed decision changed»; `Review closure`; `Pruning`; в `platform` — шаги `Close the change` | общий для всех репозиториев шаг сверки в `WORKFLOW.md`: перечислить изменённые факты, сравнить с заявленными в спецификации, неожиданное влияние — в отчёт или владельцу; таблицы авторитетов в Workspace и `inside-telegram` |
| Review (`code-review`) | две оси в отдельных субагентах; Spec ищет недостающее, лишнее и неверное | вопрос о документах и правилах: ни в одной оси он не назван явно, хотя документы попадают в diff |
| CI | `platform`: `docs:check` (указатели + закреплённые факты), `api:check`, `mcp:check`; Workspace: `health`, `diff`, тесты harness | ничего срочного: детерминированная часть уже есть; расширения — в [предыдущем исследовании](2026-09-24-agent-knowledge-and-doc-drift.md) |
| PR-отчёт | разделы «Изменения бизнес-правил», «Изменения документации», «Решения владельца» | требование назвать источник для каждого нового или изменённого правила |
| Post-merge | — | doc-gardening отложен (предыдущее исследование) |
| Выпуск harness | `SOURCE.md`: «test a pilot repository»; тесты `harness/tests` проверяют установку, реестр и указатели | поведенческие evals: ни один тест не проверяет, что агент с harness ведёт себя иначе |

**Третья ось или вопрос в осях.** Предлагается не добавлять третью ось, а дать вопрос двум
существующим. Тогда каждая проверяет то, что ей свойственно:

- **Spec** получает два пункта. (d) Какие долговечные факты меняет diff и обновлены ли их
  документы; сверка с разделом «Документы и правила» спецификации. (e) Какие нормативные
  утверждения появились в документах и harness без источника в спецификации или решении
  владельца — это выход за рамки.
- **Standards** читает таблицу авторитетов репозитория как документированный стандарт и
  проверяет, что факт записан в правильное место.

Довод за этот вариант: раздел «Why two axes» в skill объясняет оси как «что просили» и «как
принято». Документы ложатся в обе. Третья ось — ещё один параллельный субагент на каждое
ревью. Довод против: вопросы о документах могут тонуть среди находок по коду. Это как раз
измеряют случаи 7–9 из раздела 4.3. Если они покажут, что вопрос теряется, отдельная ось
оправдана.

`code-review`, `to-spec` и `implement` — адаптированные skills Мэтта Покока. Правка
записывается в `SOURCE.md` → «Inside adaptations to the Matt base», как уже сделано для
`implement`.

## 6. Рекомендация для общей спецификации

Учтены решения владельца от 2026-09-24: одна общая спецификация на всю работу; проверка ручных
правок harness в CI потребителей не нужна; универсального числа задач на спецификацию нет.

Порядок выбран так: сначала дешёвые правки процесса, которые дают эталон для сравнения, потом
ревью, которое этот эталон использует, и только потом измерение.

1. **Раздел «Документы и правила» в `to-spec`.** Спецификация называет изменяемые долговечные
   факты, их авторитетные документы и новые правила с источником решения. *Почему первым:*
   без заявленного влияния ревью не с чем сравнивать. Это traceability в самом дешёвом виде.
2. **Шаг сверки влияния в `WORKFLOW.md`.** Общий для всех репозиториев, рядом с `Ready and
   Done` и `Pruning`: перечислить изменённые факты, обновить каждый в одном авторитетном
   документе, неожиданное влияние и новые правила вынести в отчёт. Контракт `platform`
   становится частным случаем; Workspace и `inside-telegram` получают свои таблицы авторитетов.
   *Почему:* исследования показывают, что сверка с документами сама не происходит и
   документация отстаёт от кода.
3. **Вопросы о документах и правилах в `code-review`.** Пункты (d) и (e) в оси Spec, таблица
   авторитетов как стандарт для оси Standards. *Почему:* независимый проверяющий в чистом
   контексте — основная защита от выдуманного правила (класс «в»), и оси уже работают
   отдельно.
4. **Источник каждого правила в PR-отчёте.** В разделе «Изменения документации» для нового или
   изменённого правила — ссылка на спецификацию, решение владельца или ADR; правило без
   источника — в «Решения владельца» как предложение. *Почему:* дёшево и делает класс (в)
   видимым владельцу при merge.
5. **Небольшой фикстурный набор evals harness.** 6–9 случаев из раздела 4.3, три прогона,
   сначала grader'ы на коде, запуск при выпуске canonical package и после реального промаха.
   *Почему последним:* он измеряет, работают ли пункты 1–4. Без них мерить нечего, а стоимость
   прогонов заметная.

**Отложить:**

- *LLM-судья в CI на каждом PR.* Пока нет evals самого судьи, неизвестно, как часто он
  ошибается. Сначала случаи 7–9 на `code-review`.
- *Stop hook с проверкой документов.* Форматы runtime'ов разные, agent hooks Claude Code
  экспериментальные, harness Inside намеренно без хуков.
- *Claude Code Review как управляемый сервис.* Research preview, только Team и Enterprise,
  $15–25 за ревью. Идею «в обе стороны» переносим в свой `code-review`.
- *Платформа OpenAI Evals.* Закрывается 2026-11-30.
- *Online evals по traces.* Inside не собирает traces; начинать с offline набора дешевле.
- *Правила «путь → документ» (Danger и аналоги).* Отложены ещё в предыдущем исследовании.

## 7. Решения владельца и открытые вопросы

Решения владельца от 2026-09-24:

- **Кто вправе добавить правило в harness.** Агент записывает новое или изменённое правило сам,
  только если у него есть источник: спецификация, ADR, решение владельца или факт о среде,
  подтверждённый проверкой. Источник указывается в отчёте PR. Правило без источника уходит в
  «Решения владельца», и ревью блокирует PR до решения.
- **Evals harness.** В общую спецификацию не входят. Владелец хочет сначала лучше разобраться в
  теме; разделы 4 и 6 остаются справочными.
- **Калибровка grader'ов, когда evals появятся.** Отдельная сессия сверяет все прогоны,
  владелец читает расхождения и выборку.

Исходные вопросы (вопросы 1 и 5 закрыты решениями выше, 3 и 4 отложены вместе с evals):


1. **Кто вправе добавить правило в harness.** Любое новое или изменённое правило в
   `AGENTS.md`, `CODING_STANDARDS.md`, `WORKFLOW.md` или skill — это всегда решение владельца?
   Или агент может сам закрепить правило из находки ревью по `Review closure`, если оно
   обобщается? От ответа зависит, блокирует ли пункт (e) ревью или только сообщает.
2. **Третья ось или вопросы в осях.** Рекомендация — вопросы в Spec и Standards, с проверкой
   случаями 7–9. Согласен ли владелец начать так?
3. **Где живёт набор evals и на каких runtime'ах.** Предложение — каталог в Workspace рядом с
   `harness/tests`, прогон на Claude Code и Codex. Нужен ли Kimi или OpenCode?
4. **Бюджет прогонов.** Около 50 агентных прогонов на выпуск harness — приемлемо?
5. **Кто калибрует grader.** Первые прогоны владелец читает сам или поручает отдельной сессии
   с последующей выборочной проверкой?

## 8. Источники

Дата проверки всех ссылок — 2026-09-24. Если на странице есть дата публикации или обновления,
она указана.

**Anthropic и Claude Code**
- [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) — 2026-01-09.
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — 2024-12-19. Evaluator-optimizer: «particularly effective when we have clear evaluation criteria».
- [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) — 2025-09-11. Отложенные наборы: «held-out test sets to ensure we did not overfit».
- [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — 2025-11-26. Сбой «mark a feature as complete without proper testing».
- [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) — 2025-10-16, обновление 2025-12-18.
- [Improving skill-creator](https://claude.com/blog/improving-skill-creator-test-measure-and-refine-agent-skills) — 2026-03-03.
- [skill-creator SKILL.md](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) — ветка `main`, дата не указана.
- Claude Code: [skills](https://code.claude.com/docs/en/skills), [plugin evals](https://code.claude.com/docs/en/plugin-evals), [best practices](https://code.claude.com/docs/en/best-practices), [hooks](https://code.claude.com/docs/en/hooks), [code review](https://code.claude.com/docs/en/code-review), [memory](https://code.claude.com/docs/en/memory) — даты не указаны.

**OpenAI** (страницы закрыты от автоматического чтения, цитаты по снимкам Wayback)
- [Harness engineering](https://openai.com/index/harness-engineering/) — 2026-02-11; [снимок 2026-09-13](https://web.archive.org/web/20260913183535/https://openai.com/index/harness-engineering/).
- [Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills) — 2026-01-22; снимок 2026-09-21.
- [Custom Code Review rules for Codex](https://developers.openai.com/blog/custom-code-review-rules-for-codex) — 2026-07-20; [снимок 2026-08-27](https://web.archive.org/web/20260827213557/https://developers.openai.com/blog/custom-code-review-rules-for-codex).
- [Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals) — дата не указана; снимок 2026-09-20.
- [Trace grading](https://developers.openai.com/api/docs/guides/trace-grading), [graders](https://developers.openai.com/api/docs/guides/graders), [evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices) — даты не указаны.
- [Deprecations](https://developers.openai.com/api/docs/deprecations) — снимок 2026-09-23: Evals только для чтения с 2026-10-31, закрытие 2026-11-30.
- [Codex GitHub integration](https://developers.openai.com/codex/integrations/github) — дата не указана; снимок 2026-07-08.
- [Build an Agent Improvement Loop with Traces, Evals, and Codex](https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop) — 2026-05-12.

**GitHub**
- [Customize Copilot code review](https://docs.github.com/en/copilot/tutorials/customize-code-review) — дата не указана.
- [GitHub Agentic Workflows public preview](https://github.blog/changelog/2026-06-11-github-agentic-workflows-is-now-in-public-preview/) — 2026-06-11.
- [Automate repository tasks with GitHub Agentic Workflows](https://github.blog/ai-and-ml/automate-repository-tasks-with-github-agentic-workflows/) — 2026-02-13.
- [gh-aw: documentation workflows](https://github.github.com/gh-aw/blog/2026-01-13-meet-the-workflows-documentation/) — 2026-01-13; [gh-aw CLI](https://github.github.com/gh-aw/setup/cli/) — дата не указана.
- [Continuous AI](https://githubnext.com/projects/continuous-ai/) — 2025-06, WIP.
- [How to write a great agents.md](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/) — 2025-11-19. Статья о custom agents в `.github/agents/`, методики анализа в ней нет.

**Другие практики**
- [Spotify: Background Coding Agents, Part 3](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3) — 2025-12-09.
- [Mintlify agent](https://www.mintlify.com/docs/agent), [Mintlify automations](https://www.mintlify.com/docs/guides/use-automations) — даты не указаны.
- [Google: What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — дата не указана.
- [GitLab documentation workflow](https://docs.gitlab.com/development/documentation/workflow/) — по `ai-engineering`, здесь не перечитывалось.
- [Scrum Guide 2020](https://scrumguides.org/docs/scrumguide/v2020/2020-Scrum-Guide-US.pdf) — ноябрь 2020. «The Definition of Done is a formal description of the state of the Increment when it meets the quality measures required for the product.»
- SWEBOK v3, глава 5 — [копия на сайте университета](https://mireilleblayfornarino.i3s.unice.fr/lib/exe/fetch.php?media=teaching%3Areverse%3Aswebokv3_-_chap5_-_code_maintenance.pdf).
- Gotel, Finkelstein, [An analysis of the requirements traceability problem](http://discovery.ucl.ac.uk/749/1/2.2_rtprob.pdf) — ICRE 1994, DOI 10.1109/ICRE.1994.292398.

**Исследования**
- Файлы контекста: [2602.11988](https://arxiv.org/abs/2602.11988) (v2 2026-06-23), [2601.20404](https://arxiv.org/abs/2601.20404) (2026-01-28), [2607.27250](https://arxiv.org/abs/2607.27250) (2026-07-28), [2605.10039](https://arxiv.org/abs/2605.10039) (2026-05-11), [2509.14744](https://arxiv.org/abs/2509.14744) (2025-09-18, 253 файла `CLAUDE.md`), [2511.12884](https://arxiv.org/abs/2511.12884) (v2 2026-08-09, 2 303 файла контекста: «evolve like configuration code through frequent, small additions»).
- Соблюдение правил: [OctoBench 2601.10343](https://arxiv.org/abs/2601.10343), [RepoComplianceBench 2607.26819](https://arxiv.org/abs/2607.26819), [AgentIF 2505.16944](https://arxiv.org/abs/2505.16944).
- Агенты и документация: [2608.20195](https://arxiv.org/abs/2608.20195) (2026-08-20).
- Оценка агентов: [Agent-as-a-Judge 2410.10934](https://arxiv.org/abs/2410.10934), [τ-bench 2406.12045](https://arxiv.org/abs/2406.12045), [SWE-bench 2310.06770](https://arxiv.org/abs/2310.06770), [PatchDiff 2503.15223](https://arxiv.org/abs/2503.15223), [UTBoost 2506.09289](https://arxiv.org/abs/2506.09289).
- LLM-судьи и ревью: [MT-Bench 2306.05685](https://arxiv.org/abs/2306.05685), [CodeJudgeBench 2507.10535](https://arxiv.org/abs/2507.10535), [c-CRAB 2603.23448](https://arxiv.org/abs/2603.23448).
- Агентные PR: [AIDev 2602.09185](https://arxiv.org/abs/2602.09185), [2509.14745](https://arxiv.org/abs/2509.14745) (83,8% PR Claude Code приняты), [2601.15195](https://arxiv.org/abs/2601.15195).
- Устаревшая документация: [2212.01479](https://arxiv.org/abs/2212.01479), [2307.04291](https://arxiv.org/abs/2307.04291), [2010.01625](https://arxiv.org/abs/2010.01625).

**Состояние Inside (только чтение, 2026-09-24)**
- Workspace, ветка `research/agent-knowledge-and-doc-drift`: `harness/packages/inside-engineering/WORKFLOW.md`, `SOURCE.md`, `manifest.json` (0.4.7), `skills/code-review/SKILL.md`, `skills/implement/SKILL.md`, `skills/to-spec/SKILL.md`, `skills/to-tickets/SKILL.md`, `github/pull_request_template.md`, `harness/tests/`.
- `platform` `6ce6b22f`: `docs/agents/documentation-maintenance.md`, `scripts/check-agent-documentation.mjs`, `scripts/agent-documentation-contract.test.mjs`, `package.json`.
- `ai-engineering` `11e03eb`: `docs/research/2026-09-22-learning-coding-harness.md`, `2026-09-22-agentic-design-patterns.md`, `2026-09-22-learning-huggingface-anthropic.md`, `2026-09-24-harness-of-harness.md`, `2026-09-22-team-agent-platform-cases.md`, `2026-09-22-documentation-and-retrieval.md`, `2026-09-24-spec-first-from-chapter-one.md`, `docs/harness.md`, `docs/content-harness.md`, `docs/decisions.md`.

**Не подтверждено**
- Строка о превращении упавшего trace в регрессионный случай на странице OpenAI agent-evals.
- Загрузка `AGENTS.md` или `CLAUDE.md`, созданного `scaffold_script`, внутри прогона `claude plugin eval`.
- Читает ли Claude Code Review `AGENTS.md`, импортированный через `@AGENTS.md` в `CLAUDE.md`.
- Точная формулировка определения change impact analysis у Bohner и Arnold (1996); использован SWEBOK v3.
- Название раздела правил ревью в текущей версии страницы Codex GitHub (в снимке — «Review guidelines»).
- Promptfoo как общий раннер для Claude Code и Codex.
