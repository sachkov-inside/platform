# Как мыслить при создании Dockerfile для Go

Рядом лежит учебный [`Dockerfile.go`](Dockerfile.go). В репозитории нет Go-проекта, поэтому этот
Dockerfile не запускаем. Он нужен для сравнения с NestJS и ASP.NET Core.

Общая механика `FROM`, build context, `COPY`, layers, `RUN`, `EXPOSE`, `CMD` и перехода от
`docker build` к `docker run` подробно разобрана в
[`apps/backend/Dockerfile.md`](../../apps/backend/Dockerfile.md).

## Сначала формулируем обычный запуск

На чистой Linux-машине для Go-приложения нужно:

1. Установить Go toolchain.
2. Поместить на машину `go.mod`, `go.sum` и исходники.
3. Скачать Go modules.
4. Скомпилировать исполняемый binary.
5. Запустить этот binary.

```bash
go mod download
go build -o /app/server .
/app/server
```

## Первый Dockerfile

```dockerfile
FROM golang:1.27-alpine

WORKDIR /app

COPY . .

RUN go mod download
RUN go build -o /app/server .

EXPOSE 8080

CMD ["/app/server"]
```

## `FROM`: зачем нужен Go image

```dockerfile
FROM golang:1.27-alpine
```

Для превращения `.go`-файлов в executable нужны:

- команда `go`;
- Go compiler;
- стандартная библиотека;
- tooling для Go modules;
- системные файлы Alpine.

`golang:1.27-alpine` предоставляет эти инструменты. Его filesystem layers становятся началом
build stage.

Первый вариант использует тот же image для сборки и запуска. После компиляции Go toolchain обычно
уже не требуется, поэтому будущий multi-stage Dockerfile заметно сократит final image.

## `WORKDIR`: рабочая директория

```dockerfile
WORKDIR /app
```

Docker создаст `/app` и будет выполнять следующие инструкции из этой директории.

## `COPY`: зачем compiler нужны файлы проекта

```dockerfile
COPY . .
```

Base image содержит compiler, но не содержит `go.mod`, `go.sum` и `.go`-файлы конкретного
приложения. Сборщик также не читает произвольные папки Mac.

`COPY` переносит файлы из build context в `/app` внутри stage. После этого команды `go mod` и
`go build` получают свои входные данные.

В настоящем Go-проекте `.dockerignore` исключал бы `.git`, локальные binaries, coverage, secrets
и временные файлы.

## `RUN go mod download`: что скачивается

```dockerfile
RUN go mod download
```

Команда читает:

- `go.mod`: имена modules и требуемые версии;
- `go.sum`: checksums содержимого разрешённых modules.

Go скачивает исходный код внешних modules в module cache. После завершения команды cache остаётся
в image layer и используется compiler на следующем шаге.

```text
NestJS:        pnpm install
ASP.NET Core:  dotnet restore
Go:            go mod download
```

Каждая команда подготавливает внешние dependencies для сборки приложения.

## `RUN go build`: как появляется binary

```dockerfile
RUN go build -o /app/server .
```

Параметры:

- `-o /app/server`: записать результат по этому пути;
- `.`: собрать Go package из текущей директории.

Go compiler читает исходники и modules, затем создаёт:

```text
/app/server
```

Этот файл является build artifact. Он содержит машинный код для выбранных OS и CPU architecture.

Pure-Go приложение часто можно собрать без внешнего языкового runtime. Для приложения с `cgo`
могут потребоваться совместимые системные библиотеки. Final base выбирают после проверки способа
сборки и runtime dependencies.

## `EXPOSE`: предполагаемый container port

```dockerfile
EXPOSE 8080
```

Инструкция записывает container port в metadata image. Host mapping выполнялся бы отдельно:

```bash
docker run --publish 8080:8080 example-go
```

## `CMD`: непосредственный запуск artifact

```dockerfile
CMD ["/app/server"]
```

После `docker run` Docker запустил бы binary напрямую:

```text
container
└── /app/server
```

В NestJS основным процессом является `node`. В framework-dependent ASP.NET Core это `dotnet`.
В Go-примере основным процессом становится сам executable.

## Главное сравнение

```text
NestJS source       → JavaScript artifact → Node.js runtime
ASP.NET Core source → DLL artifact        → .NET runtime
Go source           → native executable   → прямой запуск
```

Go compiler нужен во время `docker build`. В pure-Go случае он не нужен после сборки. Final stage
сможет начинаться с небольшого runtime image или `scratch`, если binary самодостаточен и
приложение не требует дополнительных файлов, сертификатов или системных библиотек.

## Следующие улучшения

1. Скопировать `go.mod` и `go.sum` до исходников.
2. Выполнить `go mod download` отдельным cacheable layer.
3. Скопировать исходники и собрать binary.
4. Создать final stage без Go compiler.
5. Перенести в него только `/app/server` и необходимые runtime-файлы.
6. Запустить binary от непривилегированного пользователя.

Этот файл показывает первый читаемый вариант. Без Go-проекта он служит только опорой для
сравнения.
