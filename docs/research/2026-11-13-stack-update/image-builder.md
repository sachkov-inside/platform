# Сборочные инструменты CI

Дополнительная проверка #2117 выявила версии, которые не определяются npm manifests или версией
GitHub action. В Platform v80 (run 43582306477, job 132409930260) и Telegram v55
(run 43589645166, job 132432034351) фактически работали Buildx 0.38.2 и BuildKit 0.34.2.
Action выбирал `moby/buildkit:buildx-stable-1`; журнал сохранил index digest
`c5f8862f52499773af85bc07695b2379ef08e8002352b0df2c4864c91d78dabe`.

## Выбранное обновление

[Buildx 0.39.0](https://github.com/docker/buildx/releases/tag/v0.39.0) и
[BuildKit 0.35.0](https://github.com/moby/buildkit/releases/tag/v0.35.0) опубликованы 11 ноября 2026
как стабильные releases. Один repository-owned action `setup-image-builder` выбирает эту пару
для обеих публикаций, Development/Production Compose, native PostgreSQL recovery и ручного
full-stack smoke. Поставщик бинарного файла остаётся официальный docker/setup-buildx-action,
закреплённый по commit v4.4.1.

BuildKit выбирается по полному официальному index:
`docker.io/moby/buildkit:v0.35.0@sha256:aa632b921ef07411d2cb77292cd34213d4f7b384001d6fceef1e1f25bf9752bb`.
Его Linux amd64 child имеет digest `a521fc1fd903a46c611c733dd692548512232fba2e0386d6055846a903d05a71`,
arm64 child `7dc61a9fab7c7f5a50b1cdbbefa4180829e68c6c0172206eb54ad934de097ddf`.
Новый публичный mirror или credentials не создаются.

`BUILDX_BUILDER` явно выбирает daemon для Docker CLI, `default-load=true` сохраняет загрузку результатов обычного `docker build` в локальный image store.
Проверка после bootstrap требует фактические версии клиента и daemon. Старый клиент или daemon
вызывают отказ, даже если установка action завершилась успешно. Отрицательные Bash/Docker tests
проверяют обе границы. CI проверяет настоящие сборки, запуск и сохранность данных на Engine 28,
включая native amd64/arm64 recovery. Пара не считается совместимой лишь на основании release tag.

Ubuntu-пакет Buildx 0.30.1 на production и Docker Desktop владельца не заменяются этой настройкой.
Их фактические владельцы и каналы поставки отличаются от сборщика внутри CI.

## Security findings

Тот же Trivy DB сообщил 234 строки в фактическом прежнем index BuildKit 0.34.2: 7 critical,
106 high, 99 medium, 9 low, 13 unknown. Обновление официального образа устраняет семь
critical и уменьшает общее количество строк, но не устраняет все находки.

Свежая база Trivy от 14.11.2026 07:01 UTC сообщает 194 package findings в официальном amd64
BuildKit 0.35.0: 96 high, 79 medium, 9 low, 10 unknown, critical нет.
Четыре `buildkit-cni-*` binary дают 180 строк, преимущественно по встроенному Go 1.25.7.
Ещё десять строк относятся к `buildkit-runc`, три к `buildctl`/`buildkitd`, одна к zlib.
Это полный результат по включённым бинарным файлам и modules; он не устанавливает цепочки вызовов.
Строки не исключаются автоматически как false positive.

Остатки поставляемого upstream образа требуют отдельной security-оценки. Этот daemon запускается
в одноразовых CI runners, не развёртывается на production и не получает публичный API проекта.
Публикация использует проверенный captured main; PR CI выполняет код проверяемой ветки в изоляции.
Digest подтверждает идентичность образа, не его безопасность. Обоснования оставшихся находок и
фактические результаты CI сохраняются в PR и [production lock #2144](https://github.com/sachkov-inside/platform/issues/2144).

Platform v81 уже опубликован из frozen source `492636dd8660b44a028f0358ad9d7b86302ab9b9`,
Telegram v55 из `07ed26b7b67693cc475b2202208ab1c6639ae8dc`. Обновление будущего CI builder
не переписывает их immutable manifests, source или digest.
