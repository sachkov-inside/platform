# Помощник: библиотека агента на TypeScript

**Дата проверки:** 07.11.2026. **Тикет:** #1977, карта #1975. **Решения владельца:** #1976.
**Статус:** исследование для тикета «Помощник: техническое устройство» (#1983). Это не ADR.

## Вопрос и вывод

На какой открытой библиотеке для агентов на TypeScript строить Помощника в модуле `assistant` backend?

**Рекомендация: Vercel AI SDK 7 (`ai`, класс `ToolLoopAgent`).**
Библиотека даёт агентный цикл, потоковый ответ и интеграции, а хранение и память оставляет нам.
Поэтому разговор, пересказ и состояние Сценария лежат в нашей схеме PostgreSQL через Prisma.
Весь репозиторий AI SDK под Apache-2.0, закрытых частей нет.
Пакет `ai` 7.x уже работает в `apps/telegram` с `@ai-sdk/openai-compatible`.
Запасной вариант: Mastra. Он даёт больше готового, но несёт закрытый код `ee/` и телеметрию по умолчанию.

## Охват и ограничения

- Источники: официальная документация, файлы LICENSE в репозиториях, реестр npm, содержимое опубликованных пакетов.
- Версии и даты взяты из реестра npm 07.11.2026. Загрузки взяты из `api.npmjs.org` за период с 30.10 по 05.11.2026.
- Код прототипа не запускался. Совместимость с AITunnel проверена только по документации библиотек.
- Термины Помощник, Готовый ответ и Сценарий взяты из `GLOSSARY.md`, раздел «Assistant».
  Раздел пока лежит в ветке `docs/1975-assistant-glossary`, в `main` его нет.

## Требования из решений владельца

Требования взяты из #1976 и самого тикета #1977.

| Требование | Что нужно от библиотеки |
|---|---|
| Агентный цикл с инструментами | Цикл «модель, вызов инструмента, результат», ограничение шагов. |
| Сценарий в коде, модель только запускает | Обычный код рядом с циклом. Возможность закончить цикл после запуска Сценария. |
| Один сплошной чат на Account | Хранилище, которым владеем мы. Последние N сообщений, пересказ старых, свежие данные платформы на каждом ходе. |
| Права роли определяет сервер | Передача контекста сессии в инструменты вне текста разговора. |
| Инструменты вызывают use case внутри процесса | Обычные функции в NestJS 12 и Fastify, без отдельного сервера. |
| Провайдер через AITunnel | Любой OpenAI-совместимый endpoint. |
| Трассы в self-hosted Langfuse, стоимость каждого вызова | OpenTelemetry или готовый экспорт в Langfuse, учёт токенов на каждом шаге. |
| Инструкции и Сценарии проверяют evals | Подмена модели в тестах, запуск наборов проверок. |
| Решение по 152-ФЗ при реализации | Библиотека не отправляет данные третьим сторонам без явной настройки. |

## Сравнение

| | Vercel AI SDK | Mastra | OpenAI Agents SDK | LangGraph.js | Claude Agent SDK | VoltAgent |
|---|---|---|---|---|---|---|
| Пакет и версия | `ai` 7.0.164, 06.11.2026 | `@mastra/core` 1.82.0, 04.11.2026 | `@openai/agents` 0.21.0, 20.10.2026 | `@langchain/langgraph` 1.7.2, 07.11.2026 | `@anthropic-ai/claude-agent-sdk` 0.3.319, 06.11.2026 | `@voltagent/core` 2.11.1, 04.11.2026 |
| Лицензия | Apache-2.0 целиком | Apache-2.0, кроме каталогов `ee/` (source-available) | MIT | MIT | Commercial Terms Anthropic, не открытая | MIT |
| Загрузок в неделю | 44,9 млн | 3,1 млн | 2,5 млн | 4,9 млн | 18,2 млн | 52 тыс. |
| AITunnel | Да, `@ai-sdk/openai-compatible` | Да, объект `{ id, url }` или модель AI SDK | Да, Chat Completions или адаптер AI SDK (beta) | Да, `ChatOpenAI` с `baseURL` | Нет, только Claude | Да, через AI SDK 6 |
| Хранение в нашем PostgreSQL | Наше: библиотека хранение не навязывает | Свои таблицы `mastra_*`, есть `schemaName` | Наш класс `Session` | Свои таблицы checkpoint, есть `schema` | Файлы JSONL или `SessionStore` | Свой адаптер `@voltagent/postgres` |
| Пересказ старых сообщений | Пишем сами в `prepareStep` | Observational Memory (готово) | Сжатие только через OpenAI Responses API | `summarizationMiddleware` (готово) | Внутреннее сжатие Claude Code | Не описан |
| Сценарии | Обычный код, `hasToolCall`, `activeTools` | Workflows с suspend и resume | Обычный код | Граф с узлами | Не подходит | Workflows |
| Инструменты в процессе | `tool()` | `createTool` | `tool()` | `tool()` LangChain | Только через MCP внутри процесса | `createTool` |
| MCP-клиент | `@ai-sdk/mcp` | `@mastra/mcp` (MCP SDK 2.4) | Встроен (MCP client 2.x) | `@langchain/mcp-adapters` | Встроен | Встроен (MCP SDK 1.x) |
| Потоковый ответ в Next.js | `@ai-sdk/react` `useChat` | `@mastra/ai-sdk`, поток в формате AI SDK v7 | `@openai/agents-extensions/ai-sdk-ui` | `@ai-sdk/langchain` `toUIMessageStream` | Свой формат сообщений | Через AI SDK |
| Langfuse | `@langfuse/vercel-ai-sdk` для AI SDK 7 | `@mastra/langfuse` | Готовой интеграции для JS нет | `@langfuse/langchain` | Нет | `@voltagent/langfuse-exporter` |
| Evals | Нет, только моки `ai/test` | Scorers в `@mastra/evals` | Нет, OpenAI Evals как сервис | `openevals`, LangSmith как сервис | Нет | `@voltagent/evals` |
| Исходящие данные по умолчанию | Нет | Телеметрия PostHog включена | Трассы в OpenAI включены | Нет | Отзывы и данные использования Anthropic | Нет |
| Привязка | Низкая | Высокая | Средняя | Высокая | Очень высокая | Средняя |

## Vercel AI SDK

**Лицензия.** Файл [LICENSE](https://raw.githubusercontent.com/vercel/ai/main/LICENSE) в корне `vercel/ai`: Apache-2.0, Copyright 2023 Vercel.
Каталогов с другой лицензией нет. Пакеты `ai`, `@ai-sdk/*` в npm объявляют `Apache-2.0`.

**Зрелость.** Пакет `ai` вышел 228 раз за последние 90 дней.
Мажорные версии: 4.0 (18.11.2024), 5.0 (31.07.2025), 6.0 (22.12.2025), 7.0 (25.06.2026).
Значит, ломающий переход бывает примерно раз в полгода.
Переход с 6 на 7 переименовал много API: `stepCountIs` стал `isStepCount`, `system` стал `instructions`, `onFinish` стал `onEnd`.
Для перехода есть codemod `npx @ai-sdk/codemod v7` ([руководство 7.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0)).
AI SDK 7 требует Node.js 22 и только ESM. Backend уже ESM и работает на Node.js 26.10.0.

**Агентный цикл.** `ToolLoopAgent` назван рекомендуемым способом строить агента ([обзор агентов](https://ai-sdk.dev/docs/agents/overview)).
`stopWhen` останавливает цикл: `isStepCount(n)`, `hasToolCall(...names)` или своё условие.
`prepareStep` перед каждым шагом меняет модель, `activeTools`, `toolChoice` и список сообщений ([loop control](https://ai-sdk.dev/docs/agents/loop-control)).
В документации есть пример сжатия истории в `prepareStep` через `pruneMessages`.
`runtimeContext` и `toolsContext` передают в инструменты данные сессии вне текста разговора.
Подтверждение действия до вызова инструмента задаёт `toolApproval`, он заменил `needsApproval` в 7.0.

**Сценарии.** Готового движка нет. Документация предлагает обычный TypeScript для предсказуемых шагов ([workflows](https://ai-sdk.dev/docs/agents/workflows)).
Для Помощника это подходит: Сценарий остаётся кодом модуля `assistant`.
Модель вызывает инструмент запуска Сценария, а `hasToolCall` завершает цикл.
Дальше ходы ведёт код Сценария, модель шаги не меняет.

**Хранение.** Библиотека хранение не реализует.
Руководство прямо говорит, что `loadChat` и `saveChat` заменяются своей базой данных ([persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence)).
Рекомендуемый формат хранения: `UIMessage`. Перед отправкой модели сервер проверяет его через `validateUIMessages`.
Клиент может отправлять только последнее сообщение через `prepareSendMessagesRequest`.
Сервер сам загружает историю из базы. Это прямо совпадает со сплошным чатом на Account.

**Память.** Встроенного пересказа и «последних N» нет ([memory](https://ai-sdk.dev/docs/agents/memory)).
Страница памяти предлагает внешние сервисы (Letta, Mem0 и другие) или свой инструмент.
Для модели владельца это не мешает: последние N, пересказ и свежие данные собирает наш код до вызова агента.

**Провайдер.** `@ai-sdk/openai-compatible` 3.0.86 уже подключает OpenAI-совместимый endpoint в `apps/telegram`.
Помощник может использовать тот же адаптер и тот же AITunnel.

**Инструменты и MCP.** Инструмент задаёт `tool()` со схемой Zod и функцией `execute`.
Функция вызывает use case NestJS напрямую, без сети.
`@ai-sdk/mcp` 2.0.92 подключает внешние MCP-серверы по HTTP, SSE или stdio ([MCP](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)).
Для Помощника внешний MCP не нужен: наши инструменты работают внутри процесса.

**Потоковый ответ.** `@ai-sdk/react` 4.0.168 даёт `useChat`. Его peer-зависимость: React `^19.2.1`, это покрывает React 19.3.
Поток в формате `UIMessage` понимают адаптеры Mastra, OpenAI Agents SDK и LangGraph.
Поэтому формат чата в браузере не привязывает нас к выбору библиотеки на сервере.

**Трассы.** Телеметрия AI SDK 7 вынесена в `@ai-sdk/otel` и включается через `registerTelemetry` ([telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)).
Langfuse выпустил `@langfuse/vercel-ai-sdk` 6.1.1 именно для AI SDK 7 ([Langfuse](https://langfuse.com/integrations/frameworks/vercel-ai-sdk)).
Адрес сервера задаёт `LANGFUSE_BASE_URL`, поэтому self-hosted экземпляр подходит.
В пакете `ai` 7.0.164 нет адресов внешней телеметрии. Без зарегистрированной интеграции трассы никуда не уходят.

**Evals.** Своего фреймворка evals нет. Есть моки `MockLanguageModelV4` и `simulateReadableStream` для тестов ([testing](https://ai-sdk.dev/docs/ai-sdk-core/testing)).
Evals придётся собрать отдельно: Langfuse datasets, `evalite` 0.19.0 или Vitest с моками.

## Mastra

**Лицензия.** [LICENSE.md](https://raw.githubusercontent.com/mastra-ai/mastra/main/LICENSE.md) делит код на две части.
Каталоги `ee/` идут под [Mastra Enterprise Edition License](https://raw.githubusercontent.com/mastra-ai/mastra/main/ee/LICENSE), версия 2.0 от 22.09.2026.
Остальной код идёт под Apache-2.0.
Лицензия `ee/` прямо говорит: «They are not open source». Production-использование требует договора и ключа лицензии.
Код `ee/` лежит внутри опубликованного `@mastra/core` 1.82.0: `dist/auth/ee` (RBAC, FGA) и `dist/agent-builder/ee`.
Поле `license` пакета при этом указывает только `Apache-2.0`.
Без переменной `MASTRA_LICENSE_KEY` класс `LicenseClient` работает в режиме `open-source` и сервер лицензий не вызывает.
Помощнику части `ee/` не нужны. Но границу придётся следить при каждом обновлении.
Лицензия даёт Kepler право менять состав Enterprise Features (раздел 5.1).

**Телеметрия.** `@mastra/core` 1.82.0 содержит клиент PostHog с адресом `https://us.posthog.com`.
Телеметрия включена, пока не задана переменная `MASTRA_TELEMETRY_DISABLED=1`.
События содержат хэш имени машины, версии ОС и Node.js и сведения об использовании функций.
Для решения по 152-ФЗ переменную нужно задать во всех окружениях.

**Зрелость.** Версия 1.0 вышла 20.01.2026, сейчас 1.82.0. За 90 дней вышло 27 стабильных версий.
Пакеты `@mastra/pg` 1.35.0 и `@mastra/memory` 1.41.0 выходят с той же частотой.

**Память.** Mastra ближе всех к модели владельца из коробки.
Message history по умолчанию берёт 10 последних сообщений ([message history](https://mastra.ai/docs/memory/message-history)).
Observational Memory сжимает старые сообщения фоновыми агентами Observer и Reflector ([observational memory](https://mastra.ai/docs/memory/observational-memory)).
Порог по умолчанию: 30 000 токенов истории. Модель по умолчанию `auto`, при ключе Google выбирается `google/gemini-2.5-flash`.
Модель сжатия нужно закрепить явно, иначе данные могут уйти другому провайдеру.
При Observational Memory параметр `lastMessages` перестаёт действовать. Это не совсем «последние N плюс пересказ».
Свежие данные платформы подставляют `instructions` как функция от `requestContext` или `inputProcessors` ([Agent](https://mastra.ai/reference/agents/agent)).

**Хранение.** `PostgresStore` из `@mastra/pg` создаёт свои таблицы: `mastra_threads`, `mastra_messages`, `mastra_workflow_snapshot` и другие ([PostgreSQL](https://mastra.ai/reference/storage/postgresql)).
`schemaName` кладёт их в отдельную схему, `pool` переиспользует наш пул `pg`.
`disableInit` отключает автоматические миграции. Тогда миграции Mastra живут отдельно от миграций Prisma.

**Сценарии.** `createWorkflow` и `createStep` дают workflow со схемами шагов, suspend и resume.
Агент получает workflow через параметр `workflows` ([workflows](https://mastra.ai/docs/workflows/overview)).
Это сильная сторона для длинных Сценариев с ожиданием ответа человека.

**Провайдер.** Модель задаётся объектом `{ id, url }` для OpenAI-совместимого endpoint или моделью AI SDK ([models](https://mastra.ai/models)).
Внутри `@mastra/core` зависит от `@ai-sdk/provider` версий 5, 6 и 7.

**Сервер, поток, трассы, evals.** Есть адаптеры `@mastra/fastify` 1.5.26 и `@mastra/nestjs` 0.2.41.
Адаптер NestJS требует peer-зависимость `express`, а наш backend работает на Fastify ([server adapters](https://mastra.ai/docs/server/server-adapters)).
Адаптер не обязателен: агент можно вызвать из своего контроллера.
`@mastra/ai-sdk` 1.11.3 отдаёт поток для `useChat`, версию задаёт `version: 'v7'` ([AI SDK UI](https://mastra.ai/docs/frameworks/agentic-uis/ai-sdk)).
`@mastra/langfuse` 1.6.5 отправляет трассы в Langfuse, `baseUrl` задаёт адрес ([Langfuse](https://langfuse.com/integrations/frameworks/mastra)).
`@mastra/evals` 1.10.11 даёт scorers, быстрые проверки и выборочную оценку живых ответов ([evals](https://mastra.ai/docs/evals/overview)).

**Привязка.** Mastra задаёт свои понятия: thread, resource, workflow, processor, свой класс `Mastra`.
Уход с Mastra потребует переноса таблиц `mastra_*` и переписывания памяти и workflow.

## OpenAI Agents SDK (JavaScript)

**Лицензия.** [LICENSE](https://raw.githubusercontent.com/openai/openai-agents-js/main/LICENSE): MIT, Copyright 2025 OpenAI.

**Зрелость.** Версия 0.21.0 от 20.10.2026. Политика версий называет рост минорной версии ломающим изменением ([release process](https://raw.githubusercontent.com/openai/openai-agents-js/main/docs/src/content/docs/guides/release.mdx)).
Ломающие линии выходили 19.08, 10.09, 05.10, 08.10 и 20.10.2026. Это пять ломающих версий за два месяца.

**Трассы.** Трассировка включена по умолчанию в Node.js и отправляет данные в OpenAI ([tracing](https://raw.githubusercontent.com/openai/openai-agents-js/main/docs/src/content/docs/guides/tracing.mdx)).
В пакете `@openai/agents-openai` 0.21.0 адрес экспорта: `api.openai.com/v1/traces/ingest`.
Отключение: `OPENAI_AGENTS_DISABLE_TRACING=1` или `tracingDisabled` в `Runner`.
Langfuse описывает интеграцию только для Python ([Langfuse](https://langfuse.com/integrations/frameworks/openai-agents)). Для JS нужен свой `TracingProcessor`.

**Провайдер.** Свой `baseURL` и `setOpenAIAPI('chat_completions')` подключают OpenAI-совместимый endpoint.
Другой путь: адаптер `@openai/agents-extensions/ai-sdk`, документация называет его beta.

**Память.** Интерфейс `Session` из пяти методов позволяет хранить историю в своей базе ([sessions](https://raw.githubusercontent.com/openai/openai-agents-js/main/docs/src/content/docs/guides/sessions.mdx)).
В репозитории есть пример сессии на Prisma (`examples/memory/`).
`sessionInputCallback` обрезает историю перед вызовом модели.
Готовое сжатие `OpenAIResponsesCompactionSession` вызывает `responses.compact` из OpenAI Responses API. Через AITunnel оно не проверено.

**Остальное.** MCP-клиент встроен и зависит от `@modelcontextprotocol/client` 2.x.
Поток для `useChat` дают `createAiSdkUiMessageStreamResponse` и `createAiSdkUiMessageStream`.
Своего фреймворка evals нет. Платформа OpenAI Evals работает как внешний сервис.

## LangGraph.js

**Лицензия.** [LICENSE](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/LICENSE): MIT, Copyright 2024 LangChain.
Хостинг графов и LangSmith работают как коммерческие сервисы. Сама библиотека от них не зависит.

**Зрелость.** Версия 1.0 вышла 18.10.2025, сейчас 1.7.2 от 07.11.2026. За 90 дней вышло 22 стабильные версии.
Библиотека требует `@langchain/core` 1.3.x, поэтому в проект приходит слой LangChain.

**Память.** `PostgresSaver` из `@langchain/langgraph-checkpoint-postgres` 1.1.2 хранит состояние графа по `thread_id`.
Опция `schema` задаёт схему, конструктор принимает наш `pg.Pool` ([README](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/checkpoint-postgres/README.md)).
Таблицы создаёт `setup()`, то есть миграции живут вне Prisma.
Checkpoint сохраняет состояние после каждого шага графа. История разговора лежит внутри этих снимков, а не в наших таблицах.
`createAgent` из `langchain` 1.6.3 имеет `summarizationMiddleware` с `trigger` и `keep: { messages }` ([short-term memory](https://docs.langchain.com/oss/javascript/langchain/short-term-memory)).
`dynamicSystemPromptMiddleware` и `contextSchema` подставляют свежие данные на каждом ходе.

**Сценарии.** Граф с узлами и условными переходами хорошо описывает строгий Сценарий.
Цена: всё приложение живёт в модели графа LangGraph.

**Остальное.** `ChatOpenAI` из `@langchain/openai` 1.8.2 принимает OpenAI-совместимый `baseURL`.
`@langchain/mcp-adapters` 2.0.2 подключает MCP. `@ai-sdk/langchain` 3.0.164 переводит поток графа в формат `useChat` ([адаптер](https://ai-sdk.dev/providers/adapters/langchain)).
`@langfuse/langchain` 6.1.1 отправляет трассы в Langfuse. Evals: `openevals` 0.2.3 (MIT) или LangSmith как сервис.

## Claude Agent SDK

**Лицензия.** [LICENSE.md](https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/LICENSE.md): «All rights reserved», использование по Commercial Terms of Service Anthropic.
В npm поле лицензии: `SEE LICENSE IN README.md`. Это не открытая лицензия, требование владельца не выполнено.

**Устройство.** SDK запускает нативный бинарный файл Claude Code через optional-зависимости npm ([quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart.md)).
Провайдеры: Anthropic API, Amazon Bedrock, Claude Platform on AWS, Google Cloud, Microsoft Foundry. OpenAI-совместимого провайдера нет.
Сессии пишутся в `~/.claude/projects/<cwd>/*.jsonl`, перенос даёт адаптер `SessionStore` ([sessions](https://code.claude.com/docs/en/agent-sdk/sessions.md)).
Встроенные инструменты читают файлы и запускают команды. Это инструмент для агентов над кодом, а не для чата ученика.
README говорит, что SDK собирает отзывы и данные использования.

**Вывод.** Кандидат исключён: закрытая лицензия, один провайдер, отдельный процесс на каждый запрос.

## VoltAgent

**Лицензия.** [LICENCE](https://raw.githubusercontent.com/VoltAgent/voltagent/main/LICENCE): MIT, Copyright 2025 VoltAgent Inc.

**Зрелость.** Версия 2.11.1 от 04.11.2026, 3 стабильные версии за 90 дней, 52 тыс. загрузок в неделю.
`@voltagent/core` требует peer-зависимость `ai@^6.0.0`. Значит, VoltAgent отстаёт от AI SDK 7, который уже стоит в `apps/telegram`.

**Возможности.** Память хранит историю и рабочую память, адаптер Postgres лежит в `@voltagent/postgres` 2.1.3 ([memory](https://voltagent.dev/docs/agents/memory/overview/)).
Пересказа старых сообщений документация не описывает: старые сообщения отбрасываются по лимиту.
Основная наблюдаемость идёт через сервис VoltOps. Для Langfuse есть `@voltagent/langfuse-exporter` 2.0.3.
Сервис VoltOps (`api.voltagent.dev`) вызывается только при заданных ключах.

**Вывод.** VoltAgent добавляет слой поверх AI SDK, но отстаёт от него на мажорную версию. Выгоды перед чистым AI SDK нет.

## Модель памяти владельца в каждой библиотеке

Модель владельца: один чат на Account, последние N сообщений, пересказ старых и свежие данные платформы на каждом ходе.

| Библиотека | Последние N | Пересказ старых | Свежие данные на ходе | Где хранится |
|---|---|---|---|---|
| AI SDK | Наш запрос к базе | Наш вызов модели, наша таблица | Наш код в `instructions` или `prepareStep` | Наша схема, Prisma |
| Mastra | `lastMessages` (по умолчанию 10) | Observational Memory, порог 30 000 токенов | `instructions(requestContext)`, `inputProcessors` | `mastra_*` в отдельной схеме |
| OpenAI Agents SDK | `sessionInputCallback` | Только через OpenAI Responses API, иначе свой код | Свой код в `instructions` | Наш класс `Session` |
| LangGraph.js | `trimMessages` | `summarizationMiddleware` | `dynamicSystemPromptMiddleware` | Checkpoint-таблицы в отдельной схеме |
| VoltAgent | Лимит сообщений | Не описан | Свой код | Адаптер `@voltagent/postgres` |

В AI SDK память приходится писать самим. Но это небольшая часть кода.
Нужны два запроса Prisma, одна таблица пересказа и один вызов `generateText` для обновления пересказа.
Зато правила памяти прозрачны и проверяются evals без внутренних порогов библиотеки.

## Рекомендация и причины

**Выбор: Vercel AI SDK 7.** Причины в порядке веса:

1. **Лицензия.** Apache-2.0 на весь репозиторий. Нет каталогов `ee/` и ключей лицензии, как у Mastra.
2. **Данные остаются у нас.** Нет телеметрии и трасс по умолчанию. Это проще для решения по 152-ФЗ, чем у Mastra (PostHog) и OpenAI Agents SDK (трассы в OpenAI).
3. **Хранение в нашей схеме.** Разговор, пересказ и состояние Сценария лежат в схеме `assistant` через Prisma 7. Это соответствует ADR 0003. Чужих таблиц и отдельных миграций нет.
4. **Одна библиотека в репозитории.** `ai` 7.x и AITunnel через `@ai-sdk/openai-compatible` уже работают в `apps/telegram`.
5. **Сценарии остаются кодом.** `hasToolCall`, `activeTools` и `toolChoice` дают точку передачи управления от модели коду Сценария.
6. **Готовые части есть.** `useChat` для Next.js 16, официальный экспорт в Langfuse для AI SDK 7, `toolApproval` для действий админа.
7. **Низкая привязка.** Формат `UIMessage` понимают адаптеры всех остальных кандидатов. Переход на Mastra позже не меняет клиент чата.

**Цена выбора.**
- Память, пересказ и evals пишем сами.
- Мажорная версия AI SDK ломает API примерно раз в полгода. Codemod помогает, но не закрывает всё.
- `@ai-sdk/mcp` прямо называет себя лёгким клиентом без всех функций MCP. Для Помощника это неважно, инструменты работают внутри процесса.

**Когда пересмотреть.** Если долгая память или длинные Сценарии с ожиданием человека станут большими, стоит сравнить с Mastra ещё раз.
Сравнение тогда нужно начать с проверки состава `ee/` и телеметрии.

## Открытые вопросы для #1983

1. **Пересказ.** Какая таблица хранит пересказ, когда он обновляется (после каждого хода или по порогу) и какая модель его пишет?
2. **Размер окна.** Чему равно N и бюджет токенов? Как отметка материала от кнопки «Спросить об этом материале» попадает в контекст?
3. **Свежие данные.** Какие данные ученика подставляются на каждом ходе, а какие модель запрашивает инструментом?
4. **Сценарий и цикл.** Как модель запускает Сценарий (один общий инструмент или инструмент на Сценарий)? Где хранится шаг Сценария? Как ход ученика попадает в активный Сценарий без модели?
5. **AITunnel.** Поддерживает ли выбранная модель через AITunnel потоковые вызовы инструментов и параллельные вызовы? Это проверяет короткий прототип.
6. **Langfuse.** Совместим ли развёрнутый self-hosted Langfuse с `@langfuse/otel` 6.x? Где backend запускает OpenTelemetry `NodeSDK`?
7. **Стоимость.** Как стоимость каждого шага из `usage` и `onStepEnd` записывается в нашу базу рядом с трассой?
8. **Evals.** Какой инструмент запускает evals (Langfuse datasets, `evalite` или Vitest с `MockLanguageModelV4`)? Какие evals входят в CI?
9. **Поток в браузер.** Поток идёт через BFF Next.js или напрямую в backend? Как он переживает переход между страницами?
10. **Общий слой инструментов.** Как одно описание use case (схема Zod и функция) обслуживает и MCP-сервер, и Помощника без цикла зависимостей модулей (ADR 0029)?
11. **Версии.** Нужна ли одна версия `ai` для `apps/telegram` и `apps/backend` через каталог pnpm?

## Источники

- Vercel AI SDK: [LICENSE](https://raw.githubusercontent.com/vercel/ai/main/LICENSE), [агенты](https://ai-sdk.dev/docs/agents/overview), [loop control](https://ai-sdk.dev/docs/agents/loop-control), [workflows](https://ai-sdk.dev/docs/agents/workflows), [memory](https://ai-sdk.dev/docs/agents/memory), [persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence), [MCP](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools), [telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry), [testing](https://ai-sdk.dev/docs/ai-sdk-core/testing), [миграция на 7.0](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0).
- Mastra: [LICENSE.md](https://raw.githubusercontent.com/mastra-ai/mastra/main/LICENSE.md), [ee/LICENSE](https://raw.githubusercontent.com/mastra-ai/mastra/main/ee/LICENSE), [memory](https://mastra.ai/docs/memory/overview), [observational memory](https://mastra.ai/docs/memory/observational-memory), [message history](https://mastra.ai/docs/memory/message-history), [PostgreSQL](https://mastra.ai/reference/storage/postgresql), [Agent](https://mastra.ai/reference/agents/agent), [workflows](https://mastra.ai/docs/workflows/overview), [models](https://mastra.ai/models), [server adapters](https://mastra.ai/docs/server/server-adapters), [AI SDK UI](https://mastra.ai/docs/frameworks/agentic-uis/ai-sdk), [evals](https://mastra.ai/docs/evals/overview). Код: пакет `@mastra/core` 1.82.0 из npm, файлы `dist/license/index.js` и `dist/feature-telemetry-*.js`.
- OpenAI Agents SDK: [LICENSE](https://raw.githubusercontent.com/openai/openai-agents-js/main/LICENSE), исходники документации в `docs/src/content/docs/guides/` (sessions, tracing, models, mcp, streaming, release) и `extensions/ai-sdk.mdx`, [CHANGELOG agents-core](https://raw.githubusercontent.com/openai/openai-agents-js/main/packages/agents-core/CHANGELOG.md).
- LangGraph.js: [LICENSE](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/LICENSE), [add memory](https://docs.langchain.com/oss/javascript/langgraph/add-memory), [short-term memory](https://docs.langchain.com/oss/javascript/langchain/short-term-memory), [checkpoint-postgres](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/checkpoint-postgres/README.md).
- Claude Agent SDK: [LICENSE.md](https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/LICENSE.md), [README](https://raw.githubusercontent.com/anthropics/claude-agent-sdk-typescript/main/README.md), [overview](https://code.claude.com/docs/en/agent-sdk/overview), [quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart.md), [sessions](https://code.claude.com/docs/en/agent-sdk/sessions.md).
- VoltAgent: [LICENCE](https://raw.githubusercontent.com/VoltAgent/voltagent/main/LICENCE), [memory](https://voltagent.dev/docs/agents/memory/overview/), [observability](https://voltagent.dev/docs/observability/overview/).
- Langfuse: [AI SDK](https://langfuse.com/integrations/frameworks/vercel-ai-sdk), [Mastra](https://langfuse.com/integrations/frameworks/mastra), [OpenAI Agents](https://langfuse.com/integrations/frameworks/openai-agents).
- Версии, даты, лицензии и зависимости: `registry.npmjs.org`. Загрузки: `api.npmjs.org/downloads/point/last-week`.
