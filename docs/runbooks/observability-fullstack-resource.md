# Ресурсный профиль #1566

Подготовленный Linux fixture включает весь перечисленный ниже процессный контур.
`measured_linux_acceptance` относится к измеренному синтетическому workload целиком.
Во время ON выполняется тот же ограниченный PG/Caddy cache sampler раз в 5 секунд.
Его нагрузка и запросы чтения входят в измерение. `source_cache_workload` подтверждается
только после реальных native samples и чтения обеих свежих source-серий из VictoriaMetrics;
до этого он остаётся в `missing`, а `measured_linux_acceptance` не может дать PASS.
Общая production `acceptance` остаётся `incomplete`: физический Timeweb хост и семь дней
наблюдения требуют собственного последующего подтверждения. До фактического Linux PASS
этот профиль не даёт принятой рекомендации по мощности сервера.

`infra/observability/fullstack/profile.json` задаёт воспроизводимый синтетический конверт:
256 отдельных доверенных Account, 512 опубликованных Material, 8 одновременных запросов,
полный sampling traces. Это тестовые значения, а не измеренная посещаемость production.
27.10.2026 read-only запросы вернули только агрегаты production: 180 Account, 190 BotContact,
82 Material, из них 55 опубликованных. Идентификаторы и пользовательские данные не читались.
256 тестовых участников и 512 опубликованных материалов превышают текущую численность;
история, объём production баз и реальная посещаемость этим корпусом не воспроизводятся.

Production-образ backend не содержит development seed entry points. Проверочный корпус
переиспользует два исходных модуля существующего development seed: закреплённый Node 26
удаляет их TypeScript-типы внутри уже зарегистрированного migration service и пишет результат
только в отдельный свежий tmpfs на 1 MiB. Исходники монтируются только для чтения,
bootstrap требует явного тестового переключателя и `NODE_ENV=development`.
Небольшой fixture entry вызывает прежний `seedLocalDevelopment` с `demo=published`,
используя production `parsePlatformConfig` и `createPrismaClient`. Development CLI с
его отдельным `load-platform-config` не входит в production compile closure и не запускается.
Новый образ или контейнер вне существующего supervisor не создаётся; production payload
и набор зависимостей приложения не расширяются. Сам seed работает только с изолированной базой корпуса.

В одном изолированном Compose project работают Web, API, Platform MCP, пять workers,
RabbitMQ с теми же TLS/definitions, PostgreSQL 18 foundation и отдельная база Umami в том же
кластере. Telegram запускается из текущего production Dockerfile со своими миграциями,
базой и рабочими циклами. 256 синтетических BotContact создаются через webhook.
Logto собирается из закреплённого fork и выполняет реальные seed/alteration migrations.
Web и API читаются через Caddy HTTPS с проверкой выданного им локального сертификата.
Технический контур использует подготовленную production-топологию: VictoriaMetrics,
VictoriaLogs, VictoriaTraces, Alloy, vmauth, query gateway, Grafana и отдельный Linux host-agent.
Внешние операции остаются синтетическими. Запрещены обращения к банку, реальной почте,
реальному Telegram и storage. Собственный закрытый HTTPS Bot API peer принимает
только закреплённый синтетический bot token и ограниченные методы, без внешнего доступа. Browser tracker production остаётся выключенным; fixture отправляет
фиксированные аналитические события в собственную Umami напрямую.
Проверка `/ready` Telegram включает настоящий probe `getMe` → `getChatMember` самого bot.
Тестовый peer подтверждает роль administrator только для bot `1566` в фиксированном
синтетическом chat; для 256 тестовых контактов возвращает `left`. Это ответ изолированного
peer, не проверка прав или изменение роли настоящего production bot.
Одноразовый `ready` client завершает собственный Node process после callback записи полного
закрытого результата в stdout. Ожидающий DNS lookup не продлевает его жизнь после сетевого отказа;
результат timeout остаётся `ok: false`, а готовность определяется прежним содержимым ответа.
При отказе готовности `fullstack_readiness` сохраняет отдельно последний завершённый ответ и исход
родительского probe: `completed`, `timeout`, `command_failed` либо `subprocess_failed`. Только закрытая
проекция `ok/status/cause` может попасть в диагностику. Частичный JSON от незавершившегося child
не доказывает готовность, даже если содержит `ok: true`. На terminal failure один ограниченный
read-only lookup проверяет project/service/CID для `loadgen`, `telegram`, `bot-provider` и публикует
только state/running/OOM/exit code/restarts. Raw stdout/stderr, provider responses, labels и IDs не
публикуются; diagnostic failure не подменяет исходную ошибку. Лимиты HTTP 2 s, child 4 s и readiness 90 s
не меняются, container lookup использует тот же предел 4 s в сумме и не запускает повторную проверку.

Два порядка OFF/ON и ON/OFF дают четыре режима по 60 секунд. В каждом режиме: idle 10 секунд,
steady 40 секунд при 10 запросах/с, spike 10 секунд при 40 запросах/с. Одновременно читаются
мониторинг и Engine counters. P95 сравнивается отдельно для Web home, Material, API catalog и
Account, Telegram webhook и Logto OIDC discovery, при одинаковом количестве успешных наблюдений. Потребление времени самого генератора,
provider и запросов мониторинга входит в измеренный хост. OFF выключает SDK и останавливает
новый технический контур, Umami остаётся поднята с отдельной базой в обеих половинах.
Это консервативное сравнение добавленного технического мониторинга при уже работающей аналитике.

PG sampler использует отдельную обычную роль с одним соединением и read-only SQL.
До нагрузки native проверки добавляют этой роли владение тестовой схемой, SELECT на тестовую
таблицу и CREATE в `inside`. Каждый bootstrap обязан вернуть именно SQLSTATE `P1567`,
сохранив права и настройки роли; после удаления тестового права обычный bootstrap снова проходит.
В public proof попадают только три фиксированных результата `refused_unchanged`.
Caddy sampler читает только собственный loopback `/metrics`, выбирая реальный public `:443`
server из строгой native adaptation. Текстовые файлы содержат только числовые агрегаты.
Alloy читает их раз в 5 секунд; concurrent queries требуют обе source-серии с возрастом 0..10 секунд.


На каждую ON-операцию отправляется один отдельный OTLP probe с фиксированным ограниченным
номером фазы. Его HTTP ACK сверяется с сохранённым `count_over_time`, без превращения принятого
HTTP-запроса в доказательство хранения. Отдельная остановка Alloy создаёт один объяснённый отказ;
после запуска новый probe обязан сохраниться, а неподтверждённый probe не должен появиться.
Telegram отдельно сверяет количество принятых updates каждой фазы с durable rows
`processed` и очищенным payload в своей базе. HTTP 202 без последующей обработки
не даёт PASS. Это отдельная проверка от ledger синтетических probes. Корреляция приложения и полнота бизнес-фактов проверяются
отдельными native сценариями; их нельзя подменять счётчиком probes.

Проверки требуют query ≤10 s, ingestion lag ≤60 s, добавленный HTTP p95 ≤5%, добавленный средний
CPU всего хоста ≤10%, ≥25% памяти и диска в запасе, отсутствие OOM, нулевого свободного места/inodes в samples, неполного workload и
необъяснённых потерь. Отсутствующие counters, несовпадающие пары и незавершённый restart не дают
PASS. 4/8 GiB выбираются из измеренного пика занятой памяти Linux с запасом 25%; сумма
`mem_limit` не участвует. ENOSPC проверяется наблюдаемым свободным местом, успешными прикладными операциями и ledger хранения;
короткий замер не доказывает отсутствие будущего заполнения диска. Это результат для данного Linux workload, не подтверждение физического
Timeweb хоста. В начале и конце каждой фазы считываются реальные размеры всех четырёх
баз (`inside`, `umami`, `logto`, `inside_telegram`) и метаданные восьми собственных томов:
metrics, logs, traces, grafana, PostgreSQL, broker, Caddy data/config. Сохраняются выделенные
блоки, логические байты и фактические inodes, без чтения содержимого и перехода по symlinks.
Исчезнувшие при compaction записи отмечаются отдельно; снимки не являются атомарной копией
файловой системы. Общие host IO, свободные байты и inodes наблюдаются во время нагрузки;
неизвестный IO или менее 25% свободных inodes не дают PASS. Короткий профиль не устанавливает
предел будущего роста. Все восемь томов, контейнерные записи и прикладные запросы входят
в host observations. Device IO и inodes сохраняются отдельно; page cache и working set не называются RSS.
Полная история 14/90/365 дней и pgBackRest restore остаются собственными обязательными проверками,
а не экстраполяцией короткого CPU-замера.

## Воспроизведение на отдельном Linux runner

Используется committed checkout, текущие pin, существующие disk admission и storage guard.
Сборка пяти образов регистрирует имена и source identity до приобретения; при ошибке или
прерывании остаётся восстанавливаемая квитанция. Runtime использует прежний внешний supervisor
с пределом 600 секунд. В Linux CI подготовка source-образов и закреплённых runtime-образов
имеет отдельный совокупный предел роста диска 16 GiB. Перед приобретением ресурсов
проверяется свежий запас не менее 28 GiB: 10 GiB неприкосновенного остатка,
16 GiB подготовки и 2 GiB для очистки. Один исходный замер действует на все сборки
и последовательную отсортированную загрузку образов. `fullstack-preparation.json`
сохраняет закрытое имя текущего этапа, завершённые этапы и числовые замеры,
включая исходный, последний безопасный и остановочный. Это бюджет диска CI,
не требование к памяти production. Бюджеты короткого SDK-эксперимента 8 GiB
на подготовку и 4 GiB на выполнение остаются прежними. Дальнейшее расширение
времени или бюджета ради зелёного результата запрещено.
На Mac native запуск не производится при недоступном provider/probe.

```bash
python3 scripts/observability-resource/hosted.py admission --metadata /task/metadata
bash scripts/heavy-check.sh python3 scripts/observability-fullstack/prepare.py \
  --metadata /task/metadata --images /task/images.json --consumer /task/private
bash scripts/heavy-check.sh python3 scripts/observability-fullstack/fullstack.py run \
  --output /task/private --images /task/images.json
python3 scripts/observability-fullstack/fullstack.py recover \
  --output /task/private --images /task/images.json
python3 scripts/observability-fullstack/fullstack.py collect \
  --output /task/private --metadata /task/metadata --public /task/public
```

CI job `Representative whole-process monitoring OFF/ON resource proof` выполняет тот же путь.
Публикуются только `fullstack-proof.json`, `fullstack-source.json`, 12 ограниченных файлов
численных samples и общие outcomes/cleanup. Private Compose, env, сертификаты, native Umami key,
JWT и ответы прикладных API не публикуются. До фактического native PASS профиль подготовлен;
готовность процесса GitHub Actions сама по себе не означает ресурсную приёмку.
