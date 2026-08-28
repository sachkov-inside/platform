# Как мыслить при создании Dockerfile для ASP.NET Core

Рядом лежит учебный [`Dockerfile.aspnet`](Dockerfile.aspnet). В репозитории нет ASP.NET Core
проекта, поэтому этот Dockerfile не запускаем. Он нужен для сравнения stack с реальным NestJS
backend.

Общая механика `FROM`, build context, `COPY`, layers, `RUN`, `EXPOSE`, `CMD` и перехода от
`docker build` к `docker run` подробно разобрана в
[`apps/backend/Dockerfile.md`](../../apps/backend/Dockerfile.md).

## Сначала формулируем обычный запуск

На чистой Linux-машине для framework-dependent ASP.NET Core приложения нужно:

1. Установить .NET SDK.
2. Поместить на машину `.csproj` и исходный код.
3. Скачать NuGet dependencies.
4. Скомпилировать и опубликовать приложение.
5. Запустить собранную DLL через .NET Runtime.

```bash
dotnet restore
dotnet publish --configuration Release --output /app/publish
dotnet /app/publish/App.dll
```

## Первый Dockerfile

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine

WORKDIR /app

COPY . .

RUN dotnet restore
RUN dotnet publish --configuration Release --output /app/publish

EXPOSE 8080

CMD ["dotnet", "/app/publish/App.dll"]
```

## `FROM`: почему нужен SDK image

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine
```

Для сборки C# нужны:

- команда `dotnet`;
- C# compiler;
- MSBuild;
- NuGet tooling;
- reference assemblies;
- .NET и ASP.NET Core runtime.

Microsoft SDK image предоставляет эти файлы. Docker использует его filesystem layers как
начальное состояние build stage.

Первый вариант применяет SDK image и для сборки, и для запуска. Поэтому итоговый image будет
содержать compiler и SDK. В multi-stage версии publish artifact переедет в меньший
`mcr.microsoft.com/dotnet/aspnet` runtime image.

`FROM scratch` для framework-dependent приложения не подходит: DLL требует команду `dotnet` и
файлы runtime.

## `WORKDIR`: где будут находиться файлы

```dockerfile
WORKDIR /app
```

Следующие команды выполняются относительно `/app`. Исходники и publish directory будут находиться
в файловой системе build stage.

## `COPY`: зачем SDK нужны файлы проекта

```dockerfile
COPY . .
```

SDK image содержит .NET tooling, но не содержит `.csproj`, файлов `.cs`, конфигурации и ресурсов
конкретного приложения. `COPY` переносит их из build context в `/app`.

После этого `dotnet restore` сможет прочитать project file, а compiler получит исходный код.
В настоящем проекте `.dockerignore` исключал бы `bin`, `obj`, `.git`, secrets и другие локальные
артефакты.

## `RUN dotnet restore`: что скачивается

```dockerfile
RUN dotnet restore
```

Команда:

1. Находит `.csproj` или solution.
2. Читает `PackageReference`.
3. Разрешает версии NuGet packages.
4. Скачивает отсутствующие packages.
5. Создаёт данные в `obj`, необходимые следующему шагу.

После завершения временного процесса packages и restore metadata остаются в image layer.

```text
NestJS:        pnpm install читает package.json и pnpm-lock.yaml
ASP.NET Core:  dotnet restore читает .csproj и NuGet configuration
Go:            go mod download читает go.mod и go.sum
```

## `RUN dotnet publish`: как появляется artifact

```dockerfile
RUN dotnet publish --configuration Release --output /app/publish
```

Параметры:

- `--configuration Release`: собрать Release-конфигурацию;
- `--output /app/publish`: сложить готовый результат в указанную директорию.

Результат выглядит примерно так:

```text
/app/publish
├── App.dll
├── App.deps.json
├── App.runtimeconfig.json
├── referenced assemblies
└── content files
```

`App.dll` является условным именем. В реальном проекте оно определяется `.csproj`. Вся publish
directory является build artifact этого примера.

## `EXPOSE`: предполагаемый container port

```dockerfile
EXPOSE 8080
```

Image сообщает, что приложение предполагает работу на порту 8080. Host mapping задавался бы
отдельно:

```bash
docker run --publish 5000:8080 example-aspnet
```

## `CMD`: какой процесс запускается

```dockerfile
CMD ["dotnet", "/app/publish/App.dll"]
```

После `docker run` Docker запустил бы:

```text
container
└── dotnet /app/publish/App.dll
```

Процесс `dotnet` загружает assembly и запускает ASP.NET Core application. Контейнер работает,
пока работает этот процесс.

## Сравнение artifact

```text
NestJS source       → JavaScript в dist → запускает Node.js
ASP.NET Core source → DLL и publish     → запускает dotnet
```

Обоим приложениям после сборки нужен языковой runtime. Build toolchain можно оставить в отдельном
build stage.

## Следующие улучшения

1. Скопировать `.csproj` до исходников и выполнить `restore` отдельным cacheable layer.
2. Добавить `--no-restore` в `publish`.
3. Разделить SDK build stage и ASP.NET Runtime final stage.
4. Перенести в final stage только `/app/publish`.
5. Запустить приложение от непривилегированного пользователя.

Этот файл показывает первый читаемый вариант. Без ASP.NET Core проекта он служит только опорой
для сравнения.
