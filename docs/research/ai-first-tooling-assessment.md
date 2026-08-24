# AI-first codebase tooling assessment

Статус: research evidence и рекомендация для
[Platform #80](https://github.com/sachkov-inside/platform/issues/80), 2026-08-24.
Исследован checkout `5a3786198d7eb63fd10ef2c9581ea96b075b7a9d`. Инструменты не устанавливались,
tracker и production code не изменялись.

## 1. Короткий ответ владельцу

**Не добавлять Graphify, Serena или другой code-graph/indexing tool в обязательный Platform
foundation сейчас.** Текущий repository-owned контур уже даёт агенту canonical product/domain
docs, корневые и app-level `AGENTS.md`, маленькие capability public interfaces, import guardrails,
Storybook catalog + MCP documentation и воспроизводимые `pnpm`/Docker commands. Репозиторий пока
достаточно мал, а доказанного navigation failure, который новый runtime исправляет, в #80 нет.

Что это означает на практике:

- полноценную feature development не нужно блокировать установкой нового AI-инструмента;
- AI-first readiness следует доказывать понятными issue contracts, глубокими public interfaces,
  vertical-slice tests, architecture checks и fresh-clone local workflow — это остаётся доступно
  каждому агенту из самого repository;
- если после первых 2–3 production vertical slices появится измеряемая проблема поиска symbol
  references или impact analysis, первым кандидатом на **read-only, необязательный pilot** будет
  Serena; pilot должен отдельно доказать корректность именно на этом pnpm/Next/Nest monorepo;
- Graphify возвращается в shortlist только после исправления/обхода `tsconfig paths` и проверки
  свежести графа. Сейчас frontend Platform широко использует `@/*`, а upstream Graphify всё ещё
  имеет открытый defect: такие aliases не связываются с реальными файлами
  ([Graphify #147](https://github.com/Graphify-Labs/graphify/issues/147)).

Ни один внешний индекс не должен становиться source of truth. Canonical architecture остаётся в
versioned docs/ADR/code/tests, а индекс — только производная подсказка, которую всегда можно
перестроить или не иметь вовсе.

## 2. Какую проблему вообще мог бы решить новый инструмент

На исследованном commit в repository 671 tracked file; 145 tracked `ts`/`tsx`/`css` file содержат
около 14.5k строк. Это проверяется без стороннего runtime:

```bash
git ls-files | wc -l
git ls-files 'apps/**/*.ts' 'apps/**/*.tsx' 'apps/**/*.css' | wc -l
git ls-files 'apps/**/*.ts' 'apps/**/*.tsx' 'apps/**/*.css' | xargs wc -l
```

Уже существующий AI navigation contract:

- [`AGENTS.md`](../../AGENTS.md) маршрутизирует к product/domain/workflow/frontend authority и
  запрещает обязательные machine-local/user-level dependencies;
- [`apps/backend/AGENTS.md`](../../apps/backend/AGENTS.md) отправляет caller к capability
  `index.ts`, запрещает raw persistence imports и задаёт точную verification command;
- [`docs/agents/frontend-delivery.md`](../agents/frontend-delivery.md) задаёт production/Storybook
  ownership, presentation interface и запрет параллельного fake data path;
- [`apps/web/src/workshop/foundations-overview.mdx`](../../apps/web/src/workshop/foundations-overview.mdx)
  делает Storybook manifest и локальный `/mcp` catalog executable UI interface для людей и агентов;
- [`apps/backend/scripts/check-backend-architecture.mjs`](../../apps/backend/scripts/check-backend-architecture.mjs)
  и negative fixtures проверяют dependency direction, а не только объясняют её prose;
- TypeScript compiler, ESLint, tests, Playwright/Storybook и production builds входят в
  repository-owned `pnpm check`.

Поэтому реальный остаточный use case узок:

1. быстро получить точные callers/references конкретного symbol;
2. пройти несколько import/call hops для предварительной оценки blast radius;
3. сократить повторные file reads на выросшем repository.

Ни Graphify, ни Serena не заменяют acceptance tests, compiler, architecture guardrails или
domain docs. Graph — наблюдение о текущем code shape, не доказательство runtime behavior,
authorization, transaction semantics, Next rendering topology или product correctness.

## 3. Что мог означать `Graphify`

Название неоднозначно. Нельзя безопасно написать в task просто «добавить Graphify» без owner
choice и exact upstream.

### Наиболее вероятный кандидат

**[Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify)** — наиболее вероятное
значение в контексте AI-first code navigation. Это текущая официальная Python-линия Graphify Labs;
старый `safishamsi/graphify` перенаправляет в эту organization, официальный package называется
`graphifyy`, а official security page называет именно этот repository
([official identity](https://graphify.com/security),
[package metadata](https://github.com/Graphify-Labs/graphify/blob/v8/pyproject.toml)). Он строит
локальный code knowledge graph, имеет CLI/skill/MCP integration и прямо перечисляет Codex среди
клиентов.

### Другие реальные кандидаты

- **[rhanka/graphify](https://github.com/rhanka/graphify)** / `@sentropic/graphify` — отдельная
  TypeScript product line. Сам repository говорит, что это port, который отслеживает parity с
  upstream Python Graphify, и перечисляет ещё незакрытые gaps
  ([UPSTREAM_GAP.md](https://github.com/rhanka/graphify/blob/main/UPSTREAM_GAP.md)). Это не
  официальный Graphify Labs package и не взаимозаменяемая implementation.
- **`@mohammednagy/graphify-ts`** — старое имя другого local context tool; package официально
  помечен как переименованный в `@lubab/madar`
  ([npm deprecation/rename notice](https://www.npmjs.com/package/%40mohammednagy/graphify-ts)).
  Новую adoption decision нельзя записывать под устаревшим именем.
- Academic **Graphify GraphQL-to-Gremlin** решает генерацию graph backend, а не AI navigation
  ([paper](https://arxiv.org/abs/2604.27223)); к #80 он не относится.

Дальше слово **Graphify** означает только официальный `Graphify-Labs/graphify`.

## 4. Graphify: capability и fit

### Что действительно даёт

Graphify локально разбирает code через tree-sitter и записывает functions, classes, imports и call
edges в graph; code edges имеют provenance (`EXTRACTED`, `INFERRED`, `AMBIGUOUS`). Для code pass
не нужен LLM, embeddings или vector database
([concepts](https://graphify.com/concepts),
[TypeScript/TSX extractor](https://github.com/Graphify-Labs/graphify/blob/v8/graphify/extract.py)).
Graph можно спрашивать через CLI или read-only MCP tools; default output включает `graph.json`,
HTML visualization и Markdown report
([official quickstart](https://graphify.com/docs)).

Это полезно для multi-hop structural questions, которые `rg` сам не отвечает: «какие callers
дальше зависят от этого symbol?» или «какой путь связывает два subsystem?». Но tree-sitter graph —
синтаксическая модель, не TypeScript compiler proof. Сам Graphify различает parsed и inferred
edges; их нельзя трактовать как одинаково достоверные.

### Setup и operational cost

- Python `>=3.10` и `uv`/`pipx`; MCP является optional extra
  ([install](https://graphify.com/docs/install),
  [package metadata](https://github.com/Graphify-Labs/graphify/blob/v8/pyproject.toml)). Platform
  сегодня pin-ит Node/pnpm и использует Docker, но Python/uv в project prerequisites не имеет.
- Project install способен записывать `.agents/skills`, `AGENTS.md` и `.codex/hooks.json`
  ([official install contract](https://github.com/Graphify-Labs/graphify#install)). Это пересекается
  с managed product harness. Автоматический installer нельзя запускать поверх Platform rules как
  обычный setup step; canonical harness source и существующие instructions должны оставаться
  единственным владельцем этих файлов.
- Graph является snapshot. Его нужно явно обновлять, держать watcher либо ставить git hook
  ([official freshness workflow](https://graphify.com/docs/tutorial)). Это новый daemon/hook/cache
  lifecycle и ещё одна проверка stale state.
- Проект быстро меняется. Например, только project install contract имеет свежие открытые дефекты
  о неверном scope и non-atomic mutation
  ([#2164](https://github.com/Graphify-Labs/graphify/issues/2164),
  [#2416](https://github.com/Graphify-Labs/graphify/issues/2416)). Это не делает tool плохим, но
  повышает pin/upgrade/regression cost для managed harness.

### TypeScript/Platform caveat

Graphify имеет отдельные TypeScript и TSX grammars и извлекает TS declarations/imports/calls
([extractor source](https://github.com/Graphify-Labs/graphify/blob/v8/graphify/extract.py)). Однако
открытый upstream issue прямо фиксирует отсутствие resolution для `compilerOptions.paths`
([#147](https://github.com/Graphify-Labs/graphify/issues/147)). Platform frontend определяет
`"@/*": ["./src/*"]` в [`apps/web/tsconfig.json`](../../apps/web/tsconfig.json) и уже использует
этот alias в production, tests и Storybook. Следовательно, import/impact graph на текущем checkout
может быть неполным именно на frontend seam, который #80 хочет усилить.

Official benchmark пока не снимает этот риск: опубликованный code-intelligence result использует
шесть graded questions на большом **Python** ERPNext repository и примерно 140k tokens на query,
а не Next/Nest/TypeScript monorepo
([Graphify benchmarks](https://github.com/Graphify-Labs/graphify/blob/v8/BENCHMARKS.md#results-code-intelligence)).
Это интересный signal, но не evidence для Platform adoption.

### Privacy/locality

Code AST pass выполняется локально без model call и telemetry. Но non-code inputs — docs, PDFs,
SQL/Terraform и media — могут отправляться выбранному model backend; official docs явно разделяют
эти два пути
([privacy contract](https://github.com/Graphify-Labs/graphify#privacy)). Для Platform даже pilot
должен быть **code-only**: repository docs уже canonical и не требуют probabilistic semantic edges.

### Решение

**Не принимать и не ставить сейчас.** Главные причины — недоказанная потребность на небольшом
repository, известная потеря frontend alias edges, новый Python/runtime + freshness lifecycle и
конфликт automatic installer с managed harness files. Возможная будущая роль — необязательная
visual/impact aid на code-only graph после устранения alias gap и repository-specific benchmark.

## 5. Serena: capability и fit

### Что действительно даёт

[Serena](https://github.com/oraios/serena) предоставляет MCP tools поверх language servers:
symbol search/overview, definition, implementations, references и diagnostics, а также optional
symbol-aware edits. В Codex/IDE contexts базовые file/shell tools обычно отключаются как
дублирующие возможности host agent
([tool catalog](https://oraios.github.io/serena/01-about/035_tools.html),
[features](https://oraios.github.io/serena/01-about/025_features.html)). Это лучше совпадает с
узким Platform gap, чем knowledge graph: нужен compiler/LSP-aware answer о конкретном TypeScript
symbol, а не новая semantic memory.

Index хранится локально и автоматически обновляется после initial project indexing
([workflow](https://oraios.github.io/serena/02-usage/040_workflow.html#indexing)). Project config
можно version-control в `.serena/project.yml`; там есть workspace folders, ignores, `read_only` и
tool allow/exclude configuration
([project template](https://github.com/oraios/serena/blob/main/src/serena/resources/project.template.yml)).

### Setup и operational cost

- `uv` и Python нужны для Serena; official quickstart рекомендует отдельный `uv tool install`,
  после чего `serena init` создаёт user-level setup
  ([official README](https://github.com/oraios/serena#quick-start)).
- Codex integration по умолчанию записывается в `~/.codex/config.toml` и запускает machine-local
  MCP process
  ([Codex client guide](https://github.com/oraios/serena/blob/main/docs/02-usage/030_clients.md#codex-cli-and-app)).
  Committed `.serena/project.yml` не pin-ит наличие/version executable на новой машине.
- Serena хранит global config, language servers и logs в `~/.serena`, а project cache/memories —
  в `.serena` по умолчанию
  ([configuration](https://oraios.github.io/serena/02-usage/050_configuration.html#serena-data-directory)).
  Memory/onboarding дублируют repository `AGENTS.md`/docs и должны быть выключены, если pilot
  состоится
  ([memory controls](https://oraios.github.io/serena/02-usage/045_memories.html#disabling-memories-and-onboarding)).
- Anonymous usage reporting включён по умолчанию; opt-out — `SERENA_USAGE_REPORTING=false`
  ([official configuration](https://oraios.github.io/serena/02-usage/050_configuration.html#usage-reporting)).
- Toolset может исполнять shell и изменять files в широких contexts. Для navigation pilot нужны
  `read_only: true` и явное исключение `execute_shell_command`
  ([security guide](https://oraios.github.io/serena/03-special-guides/serena_on_chatgpt.html#security-warning-read-carefully)).

### TypeScript/Platform caveat

Serena поддерживает TypeScript через language server и позволяет pin/override language-server и
TypeScript versions. Default documented TypeScript runtime сейчас отличается от Platform's pinned
TypeScript `6.0.3`, поэтому pilot обязан указывать workspace `tsdk`, а не молча использовать
bundled version
([TypeScript LSP configuration](https://oraios.github.io/serena/02-usage/050_configuration.html#typescript)).

Более существенно: Platform — pnpm workspace **без root `tsconfig.json`**, где `apps/web` и
`apps/backend` имеют самостоятельные configs. У Serena есть открытый reproduced issue: в таком
TypeScript monorepo tsserver может открыть files как inferred projects и `find_referencing_symbols`
возвращает неполный/пустой result
([Serena #1586](https://github.com/oraios/serena/issues/1586)). Это не доказывает, что Platform
сломается, но запрещает считать Serena correctness foundation без exact-layout acceptance test.

Наконец, официальные опубликованные Serena evaluations выполнены на платном JetBrains backend, а
не на free LSP backend, который рассматривался бы для repository-neutral setup
([evaluation scope](https://github.com/oraios/serena/blob/main/docs/04-evaluation/030_results/000_evaluation-results.md)).
Заявленный gain нельзя автоматически переносить на наш TypeScript LSP path.

### Решение

**Не принимать как dependency; оставить первым optional pilot candidate.** Serena ближе к нужной
symbol/reference задаче и не требует generated semantic graph, но machine-local MCP config,
дополнительный Python runtime и конкретный monorepo correctness risk пока не проходят Platform
autonomy contract.

## 6. Краткое сравнение

| Критерий | Текущий repository contract | Graphify Labs | Serena LSP |
|---|---|---|---|
| Главная ценность | Authority, exact search, compiler/tests, enforced boundaries | Multi-hop syntax/import/call graph и visualization | Precise symbol/reference/diagnostic tools |
| TypeScript basis | Project TS `6.0.3` + Next/Nest builds | tree-sitter TS/TSX; не compiler semantics | LSP/tsserver; version/config selectable |
| Exact Platform risk | Нет нового runtime | `@/*` alias edges могут отсутствовать | no-root-tsconfig monorepo может дать empty references |
| Locality | Полностью repository-owned | Code local; non-code semantic pass может вызвать model | Index local; dependency downloads + anonymous usage telemetry by default |
| Freshness | Files/compiler/tests являются current state | Snapshot; update/watcher/hook обязателен | LSP/cache обновляется автоматически, но process state machine-local |
| Client integration | Любой filesystem/shell capable agent | Skill/CLI/MCP, но installer меняет managed files | MCP; Codex config обычно user-level |
| New prerequisites | Нет | Python >=3.10, uv/pipx, optional MCP extra | Python/uv, Serena process, managed TS LSP runtime |
| Repository autonomy | Проходит | Не проходит как mandatory dependency без отдельного pinned wrapper | Не проходит как mandatory dependency без отдельного pinned wrapper |
| Решение сейчас | **Оставить foundation** | **Не устанавливать** | **Только будущий read-only pilot** |

## 7. Другие рассмотренные направления

- **Aider repository map** уже показывает полезный минимальный pattern: symbols + signatures и
  dependency-graph ranking под token budget
  ([official docs](https://aider.chat/docs/repomap.html)). Но это встроенная возможность одного
  agent client. Принимать Aider ради map означало бы связать project workflow с конкретным client,
  а не улучшить repository contract.
- **SCIP / `scip-typescript`** — более точный deterministic indexing primitive для definition,
  references и implementations; Sourcegraph помечает TypeScript/JavaScript indexer как GA и
  поддерживающий pnpm workspaces
  ([SCIP](https://github.com/scip-code/scip),
  [`scip-typescript`](https://github.com/sourcegraph/scip-typescript)). Но SCIP создаёт index; для
  удобной agent query surface всё равно нужен consumer/service или собственный MCP adapter. Это
  оправдано при enterprise code navigation/cross-repository scale, которого Platform пока не имеет.
- **Blarify** комбинирует LSP/SCIP и graph storage, поддерживает TypeScript, но добавляет Python и
  graph database/runtime surface
  ([official repository](https://github.com/blarApp/blarify)). Для текущего узкого gap это больше
  infrastructure, чем Serena, без доказанного Platform-specific выигрыша.
- Под названием **CodeGraph** существует несколько несвязанных проектов. Например один предлагает
  native Rust engine, 42 MCP tools и прямо указывает, что поддерживается одним разработчиком
  ([codegraph-ai/CodeGraph](https://github.com/codegraph-ai/CodeGraph)); другой строит local SQLite
  graph и TypeScript library
  ([andysom25/codegraph](https://github.com/andysom25/codegraph)). Без exact owner choice и
  repository benchmark это не стабильный dependency candidate.

Эти alternatives не меняют вывод: сначала нужен measured navigation problem, потом smallest tool,
который его закрывает.

## 8. Контракт безопасного Serena pilot, если появится evidence

Pilot не запускать автоматически из #80. Создать отдельный timeboxed ticket только когда минимум
в нескольких feature/review sessions повторится один из symptoms:

- агент не может надёжно найти все references/callers через current tools;
- impact analysis требует повторного широкого чтения repository;
- owner/reviewer обнаруживает пропущенный consumer, который index мог показать;
- navigation заметно доминирует над самой implementation/review работой.

### Сравнение на одном immutable commit

Проверить baseline и Serena на одинаковых задачах:

1. найти всех production consumers backend Materials public facet;
2. пройти от Next route к server-only adapter и backend boundary;
3. найти все callers выбранного shared UI/public interface;
4. оценить rename/contract-change impact и назвать tests;
5. отличить Storybook/workshop-only consumers от production graph.

Для каждого answer записать correctness (проверенный `rg`/TypeScript/tests), false negatives,
stale results, tool calls, elapsed time и context tokens. Нужна не demo visualization, а меньшая
стоимость при **нуле опасных false negatives** на этих acceptance queries.

### Safety/reproducibility gates

- exact Serena version и запуск описаны repo-owned wrapper/lock или container; fresh clone не
  полагается на случайный `~/.serena` state;
- project config versioned, `read_only: true`, shell/edit tools выключены;
- memories/onboarding/dashboard выключены, usage reporting выключен;
- TypeScript language server использует project-pinned `6.0.3` и корректно видит оба app tsconfig;
- intentional negative fixture доказывает cross-app/no-root-tsconfig references, а не только
  successful startup;
- `pnpm check`, build/test/run и agent work полностью работают без Serena;
- MCP/user configuration остаётся optional adapter; canonical instructions не дублируются в
  Serena memory;
- no credentials, source или docs уходят в дополнительный remote backend;
- результат pilot заканчивается explicit `adopt optional` / `reject` decision и cleanup generated
  caches/config when rejected.

## 9. Hard-to-reverse owner decisions

До отдельного owner GO нельзя:

1. делать code graph/LSP service обязательным для task readiness, review или CI;
2. менять managed `AGENTS.md`, `.agents/skills` или `.codex/hooks.json` tool installer-ом;
3. коммитить generated graph/memory как canonical project knowledge;
4. разрешать semantic upload repository docs/code во внешний provider;
5. добавлять Python/uv/Neo4j/Sourcegraph к project prerequisites;
6. принимать tool-reported «нет references» как merge/rewrite proof без compiler/search/tests.

Эти решения влияют на каждый runtime и fresh clone, поэтому при adoption требуют отдельного
repository-owned contract; обязательная cross-repository policy дополнительно принадлежит
Workspace, а не одной Platform implementation issue.

## 10. Итоговая рекомендация

| Horizon | Действие | Проверяемый результат |
|---|---|---|
| Сейчас | Не устанавливать tooling; закончить #80 через docs/contracts/issue decomposition/local environment evidence | Любой fresh-clone agent понимает boundaries и выполняет feature workflow без optional plugin |
| После первых vertical slices | Собрать реальные navigation failures и cost baseline | Есть конкретные queries, false negatives и time/tool-call evidence, а не общее ощущение |
| При подтверждённом gap | Отдельный read-only Serena pilot на pinned commit | Exact TypeScript monorepo acceptance проходит; baseline comparison показывает измеримый gain |
| Позже, при выросшем graph complexity | Повторно оценить Graphify code-only | `@/*`, workspace imports и freshness доказаны fixture-ами; installer не владеет harness files |

Самый AI-first выбор сейчас — не максимальное число MCP tools. Это repository, в котором правильный
путь очевиден из public interfaces и документов, неправильный путь блокируется guardrail/test,
а optional navigation accelerator можно удалить без потери project memory или delivery capability.
