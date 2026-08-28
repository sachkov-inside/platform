# Как мыслить при создании Dockerfile для NestJS

Рядом лежит реальный [`Dockerfile`](Dockerfile) backend Insight. Это первый, намеренно простой
вариант. Он собирается и запускает приложение, но пока не оптимизирован по размеру, cache и
безопасности.

## Сначала формулируем задачу без Docker

На чистой Linux-машине для нашего backend пришлось бы сделать следующее:

1. Установить Node.js 24.
2. Установить pnpm нужной версии.
3. Поместить на машину файлы репозитория.
4. Установить зависимости из `package.json` и `pnpm-lock.yaml`.
5. Сгенерировать Prisma Client и скомпилировать TypeScript.
6. Запустить полученный JavaScript через Node.js.

Команды проекта выражают последние три действия:

```bash
pnpm install --frozen-lockfile
pnpm --filter @inside/backend build
node apps/backend/dist/entrypoints/api.js
```

Dockerfile переносит этот порядок в воспроизводимую сборку image.

## Что создаёт Dockerfile

Dockerfile является инструкцией для `docker build`. Результатом будет image, который содержит:

- начальную файловую систему;
- Node.js и системные библиотеки;
- файлы приложения;
- установленные зависимости;
- собранный `dist`;
- рабочую директорию, порт и команду запуска.

Во время `docker build` Docker будет запускать временные процессы для инструкций `RUN`. После
сборки останется image. Постоянный backend-процесс появится после `docker run`.

```text
Dockerfile + build context
            │
            │ docker build
            ▼
          image
            │
            │ docker run
            ▼
        container
            │
            ▼
node apps/backend/dist/entrypoints/api.js
```

## Первый Dockerfile

```dockerfile
FROM node:24-alpine

WORKDIR /app

RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @inside/backend build

EXPOSE 3001

CMD ["node", "apps/backend/dist/entrypoints/api.js"]
```

## Полный маршрут `docker build`

Сборку запускаем из корня репозитория:

```bash
docker build \
  --file apps/backend/Dockerfile \
  --tag inside-api:step-01 \
  .
```

Последняя точка задаёт **build context**: набор локальных файлов, доступных сборщику.

Docker выполнит такой маршрут:

1. Прочитает Dockerfile.
2. Применит корневой `.dockerignore` к build context.
3. Найдёт локально или скачает `node:24-alpine`.
4. Возьмёт файловую систему base image как начало build stage.
5. Установит `/app` как рабочую директорию.
6. Запустит `corepack enable` во временном процессе.
7. Скопирует build context в `/app`.
8. Запустит установку зависимостей.
9. Запустит сборку backend.
10. Запишет порт и `CMD` в metadata image.
11. Сохранит результат под тегом `inside-api:step-01`.

## `FROM`: откуда берётся начальная файловая система

```dockerfile
FROM node:24-alpine
```

`FROM` выбирает **base image**, то есть начальное состояние файловой системы и конфигурации build
stage.

В `node:24-alpine` уже находятся:

- минимальный Alpine Linux userspace;
- системные библиотеки;
- команда `node`;
- npm и Corepack;
- `/bin/sh`, через который выполняются shell-инструкции `RUN`.

Когда Docker встречает `FROM`, он разрешает tag в image manifest, проверяет локальные layers,
скачивает отсутствующие layers из registry и использует их как начальную root filesystem.

`FROM` не запускает отдельную операционную систему. Он даёт сборке готовые файлы и инструменты.
Контейнеры позднее будут использовать Linux kernel Docker Desktop.

### Что будет без `FROM`

Dockerfile должен открыть build stage инструкцией `FROM`. Без неё Docker не знает, от какой
файловой системы начинать и какие команды в этой среде доступны.

Существует специальный пустой base image:

```dockerfile
FROM scratch
```

В `scratch` нет shell, Node.js и системных библиотек. Он подходит для готового самодостаточного
binary. NestJS требует Node.js, поэтому наш backend не сможет работать в `scratch`.

## `WORKDIR`: где выполняются следующие действия

```dockerfile
WORKDIR /app
```

Docker создаст `/app`, сделает её текущей и сохранит это значение в image. После этой строки:

- относительные destinations в `COPY` считаются от `/app`;
- команды `RUN` запускаются из `/app`;
- процесс контейнера по умолчанию стартует из `/app`.

## `RUN corepack enable`: откуда берётся pnpm

```dockerfile
RUN corepack enable
```

`RUN` выполняет команду во время сборки. Docker создаёт временный процесс в текущей файловой
системе stage, запускает команду и сохраняет изменения для следующего шага.

Corepack управляет JavaScript package managers. В корневом `package.json` зафиксировано:

```json
"packageManager": "pnpm@11.22.0"
```

После `corepack enable` сборка сможет вызвать именно pnpm, который использует проект.

## `COPY . .`: зачем копировать проект

```dockerfile
COPY . .
```

Build stage изолирован от файловой системы Mac. После `FROM` в нём есть Node.js и Alpine, но нет
файлов Insight. Команда `pnpm install` требует manifests, а TypeScript compiler требует исходники.
Поэтому входные файлы нужно явно добавить в image.

Формат инструкции:

```text
COPY <источник из build context> <destination внутри image>
```

В нашей строке:

```text
первая точка: корень репозитория на Mac, выбранный как build context
вторая точка: текущий WORKDIR внутри image, то есть /app
```

После копирования внутри stage будет примерно такая структура:

```text
/app
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
└── apps
    ├── backend
    │   ├── package.json
    │   ├── prisma
    │   └── src
    └── web
```

`COPY` создаёт содержимое нового image layer. Связь с локальной папкой после сборки не
поддерживается. После изменения исходников image нужно собрать заново.

Перед копированием `.dockerignore` исключает `.env`, `.git`, локальный `node_modules`, `dist`,
`.next` и другие файлы, которые не должны попадать в build context.

## `RUN pnpm install --frozen-lockfile`: что устанавливается

```dockerfile
RUN pnpm install --frozen-lockfile
```

К этому моменту manifests уже находятся внутри `/app`. pnpm:

1. Читает корневой `package.json`.
2. Читает `pnpm-workspace.yaml` и находит packages в `apps/*`.
3. Читает `apps/backend/package.json` и `apps/web/package.json`.
4. Читает точное dependency tree из `pnpm-lock.yaml`.
5. Скачивает отсутствующие packages из npm registry.
6. Складывает packages в content-addressable store.
7. Создаёт структуру `node_modules` и ссылки на packages.
8. Выполняет разрешённые lifecycle scripts.

Backend содержит:

```json
"postinstall": "pnpm prisma:generate"
```

Поэтому установка также генерирует Prisma Client.

### Что означает `--frozen-lockfile`

`package.json` описывает зависимости, а `pnpm-lock.yaml` фиксирует конкретное разрешённое дерево
пакетов. Флаг запрещает pnpm изменять lock-файл. Если manifests и lock-файл расходятся, сборка
завершится ошибкой.

После завершения временного процесса установленные файлы остаются в image layer. Следующий `RUN`
сможет использовать TypeScript, Prisma, NestJS и остальные packages.

## `RUN pnpm --filter @inside/backend build`: что собирается

```dockerfile
RUN pnpm --filter @inside/backend build
```

Insight является monorepo. В `apps/backend/package.json` указано имя:

```json
"name": "@inside/backend"
```

`--filter @inside/backend` выбирает этот workspace package. Слово `build` запускает одноимённый
script из его `package.json`:

```json
"build": "pnpm prisma:generate && tsc -p tsconfig.build.json"
```

Сначала Prisma читает `schema.prisma` и генерирует TypeScript-клиент базы данных. Затем `tsc`
компилирует исходники из `apps/backend/src` в JavaScript:

```text
/app/apps/backend/dist
```

`dist` является build artifact backend: готовым результатом сборки, который выполняет Node.js.
После завершения команды временный процесс pnpm остановится, а файлы `dist` останутся в image.

## `EXPOSE`: что означает порт

```dockerfile
EXPOSE 3001
```

Инструкция записывает в metadata image, что приложение предполагает работу на TCP-порту 3001.
Она не создаёт port mapping на Mac. Mapping задаётся во время запуска:

```bash
docker run --publish 3001:3001 inside-api:step-01
```

## `CMD`: какой процесс запускает контейнер

```dockerfile
CMD ["node", "apps/backend/dist/entrypoints/api.js"]
```

`CMD` сохраняется в metadata и не выполняется во время `docker build`. После `docker run` Docker
создаст container filesystem, сеть и writable layer, затем запустит:

```text
container
└── node apps/backend/dist/entrypoints/api.js
```

Node.js станет основным процессом контейнера. Когда этот процесс завершится, контейнер получит
состояние `Exited`.

## Что находится в первом image

```text
image inside-api:step-01
├── Alpine userspace
├── Node.js
├── Corepack и pnpm
├── весь исходный monorepo
├── development dependencies
├── production dependencies
└── apps/backend/dist
```

Image работает, но содержит исходники, compiler, Prisma CLI, тестовые packages и frontend
dependencies. Процесс также запускается от `root`.

Эти свойства дают порядок следующих улучшений:

1. Переставить `COPY`, чтобы source change не заставлял повторять dependency install.
2. Разделить сборку и запуск через multi-stage Dockerfile.
3. Перенести в final stage только runtime dependencies и `dist`.
4. Запускать процесс от непривилегированного пользователя.
5. Зафиксировать точный base image.

## Вопросы для самопроверки

1. Какие файлы даёт base image?
2. Какие файлы приходят из build context?
3. Какие файлы создаёт `pnpm install`?
4. Какие файлы создаёт `build`?
5. Какие инструкции выполняются при `docker build`?
6. Какая команда выполняется только после `docker run`?
7. Почему изменение исходника сейчас заставит повторить dependency install?
8. Что из первого image не понадобится production-контейнеру?

## Сравнение с другими stack

- [`Dockerfile.aspnet.md`](../../examples/dockerfiles/Dockerfile.aspnet.md): NuGet restore,
  `dotnet publish` и запуск DLL.
- [`Dockerfile.go.md`](../../examples/dockerfiles/Dockerfile.go.md): Go modules, компиляция binary
  и прямой запуск executable.
