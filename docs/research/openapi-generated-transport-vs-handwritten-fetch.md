# OpenAPI-generated transport vs handwritten fetch для Nest + Next

Статус: bounded primary-source research, 2026-08-26.

Документ сравнивает два варианта для текущего monorepo с одним Nest backend и одним Next web:

- **A:** Nest является authority HTTP-контракта, из него детерминированно сохраняется OpenAPI,
  TypeScript transport/types генерируются и проверяются в CI;
- **B:** web вручную поддерживает URL, `fetch`, TypeScript types и Zod runtime schemas.

Это research artifact, а не ADR. Числовой migration threshold и конкретная CI-команда ниже —
project choices; официальные источники не задают универсальный порог.

## Вердикт

Для текущего Platform лучше **A**, но решение надо разделить на две части:

1. принять committed Nest OpenAPI и generated `paths` types как обязательный contract pipeline;
2. считать runtime client заменяемой деталью одного тонкого `server-only` adapter.

`openapi-typescript` подходит для generated types и имеет штатный `--check`. Новый архитектурный
lock-in на `openapi-fetch` делать не следует: maintainers объявили, что в 2026 году
`openapi-fetch` переходит в maintenance mode, тогда как core `openapi-typescript` продолжает
развиваться
([2026 roadmap](https://github.com/openapi-ts/openapi-typescript/discussions/2559)). Если
`openapi-fetch` используется сейчас, его нужно pin-ить и спрятать за маленьким локальным adapter,
чтобы позднее заменить на native `fetch` или другой transport без переписывания feature slices.

Вариант B был бы проще для одного-двух стабильных внутренних endpoints. Platform этот порог уже
перешёл: backend имеет 13 HTTP operations, включая восемь authoring mutations/queries, public
Library/Reader, Account и Health; web уже вручную дублирует backend paths и response schemas.
Nest уже создаёт OpenAPI через
[`createApiOpenApiDocument`](../../apps/backend/src/entrypoints/api/create-api-application.ts), а
feature controllers задают explicit `operationId` и Zod-derived schemas. Следовательно, основная
начальная цена A здесь — довести контракт до quality gate и автоматизировать export/check, а не
внедрять новый API-description подход с нуля.

## Что реально дают варианты

| Критерий | A: committed OpenAPI + generated types | B: handwritten fetch + TS + Zod |
|---|---|---|
| URL, HTTP method, path/query/body | Один wire contract; literal path и параметры проверяет TypeScript | Каждое изменение вручную повторяется в Nest и web |
| Success/error wire types | Выводятся из response status/content schemas | Поддерживаются вручную и могут разойтись с backend |
| Runtime validation | **Не появляется автоматически** от `openapi-typescript`/`openapi-fetch` | Уже есть, если каждый response действительно проходит Zod parse |
| Presentation/domain mapping | Остаётся ручным feature responsibility | Остаётся ручным feature responsibility |
| Drift detection | Schema snapshot + generated-types check дают явный CI failure | Нужны integration tests; static frontend types сами drift не обнаруживают |
| Initial setup | Export, normalization, codegen, dependency pinning, CI, migration call sites | Почти отсутствует при маленьком API |
| Ongoing cost | Обновить backend contract, snapshot и generated artifact; review generated diff | Обновить URL/method/params/type/Zod/mocks во всех consumers |
| Tool risk | Generator/version upgrades и incomplete OpenAPI могут дать шум или false safety | Нет generator dependency, но permanent duplication и ручная координация |

OpenAPI предназначен для language-agnostic описания interface и позволяет tooling строить
documentation, code generation и tests
([OpenAPI 3.0.4 introduction](https://spec.openapis.org/oas/v3.0.4.html#introduction)). Nest
`SwaggerModule.createDocument()` создаёт serializable OpenAPI document со всеми HTTP routes и прямо
допускает сохранить его как JSON/YAML вместо выдачи только через UI
([Nest OpenAPI introduction](https://docs.nestjs.com/openapi/introduction)).

`openapi-fetch` на основе generated `paths` типизирует literal pathname, path/query params, request
body, 2xx `data` и 4xx/5xx `error`
([openapi-fetch](https://openapi-ts.dev/openapi-fetch/)). Это убирает ручные URL constants и type
assertions, но не владеет cache, SSR или product semantics.

## Реальная стоимость A

### Однократно

1. Сделать один factory для runtime Swagger UI и offline export, чтобы два документа не могли
   разойтись.
2. Записывать normalized deterministic schema, например `contracts/platform-api.openapi.json`:
   без timestamp, environment-specific server URL и нестабильного порядка.
3. Добавить pinned `openapi-typescript`, generated `paths` artifact и один локальный transport
   adapter в web. `openapi-fetch` — только опциональная реализация adapter.
4. Перевести существующие `requestBackend("/...")` call sites feature-by-feature.
5. Зафиксировать ownership generated files и правила обновления в coding standards.

### В каждом contract change

Backend author обновляет controller schema, регенерирует OpenAPI и TypeScript artifact в том же
commit. Review получает semantic schema diff и обычно mechanical generated diff. Массовый diff
после generator upgrade нужно делать отдельным commit; версии generator следует обновлять
осознанно.

### В CI

Минимальный gate:

```text
generate Nest OpenAPI -> compare with committed schema
validate schema -> openapi-typescript --check
web typecheck -> focused integration/contract tests
```

`openapi-typescript --check` официально проверяет, что generated types актуальны
([CLI flags](https://openapi-ts.dev/cli#flags)). Отдельное сравнение с заново созданным Nest
document необходимо, потому что `--check` проверяет generated file против переданного schema, но не
доказывает, что committed schema совпадает с текущими controllers. Детерминированный byte snapshot
и конкретный pipeline — наша CI policy, а не гарантия Nest или OpenAPI.

CI не требует поднятого HTTP server, но offline Nest bootstrap всё равно должен получить
минимальный deterministic config. Его фактическое время и зависимость от PostgreSQL надо измерить
при реализации, а не обещать заранее.

## Что generation не заменяет

### Runtime validation

Generated TypeScript доказывает только compile-time предположение. После compilation типы
стираются, и JavaScript response остаётся непроверенным
([TypeScript erased types](https://www.typescriptlang.org/docs/handbook/typescript-from-scratch.html#erased-types)).
`openapi-fetch` разбирает body, но не исполняет OpenAPI schema как validator
([official source](https://github.com/openapi-ts/openapi-typescript/blob/main/packages/openapi-fetch/src/index.js#L225-L263)).

Поэтому на важных HTTP trust boundaries web по-прежнему должен принимать payload как `unknown` и
runtime-validate его. Текущий Zod `parse`/`safeParse` именно валидирует input и возвращает typed
result/error
([Zod basics](https://zod.dev/basics#parsing-data)). A не устраняет этот cost: либо остаются
небольшие handwritten Zod schemas для consumed responses, либо позднее отдельно выбирается
OpenAPI-to-runtime-schema generator. Добавлять второй generator молча нельзя.

Backend request validation также остаётся backend responsibility. Nest прямо называет validation
incoming data best practice; Swagger metadata сама payload не валидирует
([Nest validation](https://docs.nestjs.com/techniques/validation),
[Nest Swagger CLI plugin](https://docs.nestjs.com/openapi/cli-plugin)). В Platform authority для
этого уже являются Zod contracts feature slices.

### Presentation и application semantics

Generated type описывает wire DTO, а не безопасную UI model. Feature adapter всё ещё должен:

- сузить payload до полей, реально нужных page/component;
- преобразовать backend outcomes в `notFound`, access state или unexpected error;
- нормализовать dates/cursors и построить presentation model;
- не протащить internal/auth fields в Client Component.

Next рекомендует DTO, возвращающие только необходимые поля, и `server-only` boundary для
чувствительных data access modules
([Next authentication: DAL and DTO](https://nextjs.org/docs/app/guides/authentication#using-data-transfer-objects-dto),
[preventing environment poisoning](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning)).

Generation также не заменяет Logto session/token mediation, authorization, retry/timeout policy,
observability, E2E tests и idempotency. TanStack Query продолжает владеть query keys, browser cache,
SSR hydration, pagination и invalidation; transport только выполняет typed HTTP operation. TanStack
определяет cache identity через query keys, включая все изменяемые query inputs
([TanStack Query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)).

## Quality gate для canonical OpenAPI

Генерация безопаснее ручного клиента только если документ точен. До миграции frontend каждая
consumed operation должна иметь:

1. stable unique `operationId` по programming naming conventions;
2. точные path/method, path/query/header parameters, `required`, nullability и defaults;
3. request body с правильными media type и schema;
4. все success и известные error statuses с реальным media type, включая
   `application/problem+json`, и body schema;
5. security scheme и operation-level security, включая документированные `401/403`;
6. headers, которые являются частью client contract, например idempotency или concurrency;
7. enums/formats/discriminators/recursive content без важных `{}`/`unknown` holes;
8. reusable component `$ref`, если inline recursion или polymorphism иначе теряет точность;
9. отсутствие environment-dependent или случайных полей в committed output;
10. integration proof, что критические status/content-type/body реально соответствуют документу.

OpenAPI Operation Object определяет parameters, request body, responses, callbacks, security и
unique `operationId`; Responses Object должен описывать successful и известные error responses
([OpenAPI Operation Object](https://spec.openapis.org/oas/v3.0.4.html#operation-object),
[Responses Object](https://spec.openapis.org/oas/v3.0.4.html#responses-object)). Security
Requirement names должны ссылаться на объявленные security schemes
([Security Requirement Object](https://spec.openapis.org/oas/v3.0.4.html#security-requirement-object)).

Nest reflection сама по себе не гарантирует полный schema: undecorated DTO может получиться
пустым, а interfaces, generics, circular types и polymorphism требуют explicit metadata/schema
([Nest types and parameters](https://docs.nestjs.com/openapi/types-and-parameters)). Поэтому
«OpenAPI endpoint существует» ещё не означает «контракт готов для codegen».

## Migration threshold и порядок

Официального числа endpoints, после которого codegen окупается, нет. Практический project
threshold для одного backend/одного web:

- B допустим при **1–2 стабильных private operations** и одном consumer;
- планировать A при повторном drift, нескольких feature slices или примерно **5–10 consumed
  operations**;
- обязательно перейти к A до подключения большого набора protected mutations или второго client.

Текущий Platform уже выше порога. Рекомендуемый rollout:

1. сначала quality-gate существующий Nest document и добавить deterministic export/drift check;
2. затем сгенерировать только `paths` types через `openapi-typescript`;
3. подключить тонкий `server-only` transport к Library/Reader без изменения TanStack ownership;
4. после доказательства path мигрировать Account и authoring operations;
5. сохранить runtime Zod/presentation mapping там, где payload пересекает trust boundary;
6. отдельно решить, нужен ли pinned `openapi-fetch` или достаточно небольшого native-fetch
   adapter; не принимать `openapi-react-query` как обязательный слой.

Итого: **canonical OpenAPI + generated types + CI drift — правильная долгосрочная основа уже
сейчас; `openapi-fetch` не является обязательной частью этой архитектуры и из-за maintenance mode
должен оставаться легко заменяемым.**
