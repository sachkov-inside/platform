# Ресурсный профиль #1566

Текущая первая Linux-проверка покрывает перечисленный ниже прикладной контур. Telegram, Logto и
Caddy пока не запущены этим fixture; `application_subset_acceptance` описывает только его.
Поле общей `acceptance` остаётся `incomplete`, а эти процессы явно перечислены в `missing`.
До их измерения вместе с приложением результат не даёт полной рекомендации по мощности сервера.

`infra/observability/fullstack/profile.json` задаёт воспроизводимый синтетический конверт:
128 отдельных доверенных Account, 512 опубликованных Material, 8 одновременных запросов,
полный sampling traces. Это тестовые значения, а не измеренная посещаемость production.
Запрос агрегированных production counts через SSH 24.10.2026 не прошёл banner exchange;
пользовательские данные не читались. После появления production истории конверт сверяется с ней.

В одном изолированном Compose project работают Web, API, Platform MCP, пять workers,
RabbitMQ с теми же TLS/definitions, PostgreSQL 18 foundation и отдельная база Umami в том же
кластере. Технический контур использует подготовленную production-топологию: VictoriaMetrics,
VictoriaLogs, VictoriaTraces, Alloy, vmauth, query gateway, Grafana и отдельный Linux host-agent.
Внешние операции остаются синтетическими. Запрещены обращения к банку, реальной почте,
Telegram и storage. Browser tracker production остаётся выключенным; fixture отправляет
фиксированные аналитические события в собственную Umami напрямую.

Два порядка OFF/ON и ON/OFF дают четыре режима по 60 секунд. В каждом режиме: idle 10 секунд,
steady 40 секунд при 10 запросах/с, spike 10 секунд при 40 запросах/с. Одновременно читаются
мониторинг и Engine counters. P95 сравнивается отдельно для Web home, Material, API catalog и
Account, при одинаковом количестве успешных наблюдений. Потребление времени самого генератора,
provider и запросов мониторинга входит в измеренный хост. OFF выключает SDK и останавливает
новый технический контур, Umami остаётся поднята с отдельной базой в обеих половинах.
Это консервативное сравнение добавленного технического мониторинга при уже работающей аналитике.

На каждую ON-операцию отправляется один отдельный OTLP probe с фиксированным ограниченным
номером фазы. Его HTTP ACK сверяется с сохранённым `count_over_time`, без превращения принятого
HTTP-запроса в доказательство хранения. Отдельная остановка Alloy создаёт один объяснённый отказ;
после запуска новый probe обязан сохраниться, а неподтверждённый probe не должен появиться.
Это ledger синтетических probes. Корреляция приложения и полнота бизнес-фактов проверяются
отдельными native сценариями; их нельзя подменять счётчиком probes.

Проверки требуют query ≤10 s, ingestion lag ≤60 s, добавленный HTTP p95 ≤5%, добавленный средний
CPU всего хоста ≤10%, ≥25% памяти и диска в запасе, отсутствие OOM, нулевого свободного места/inodes в samples, неполного workload и
необъяснённых потерь. Отсутствующие counters, несовпадающие пары и незавершённый restart не дают
PASS. 4/8 GiB выбираются из измеренного пика занятой памяти Linux с запасом 25%; сумма
`mem_limit` не участвует. ENOSPC проверяется наблюдаемым свободным местом, успешными прикладными операциями и ledger хранения;
короткий замер не доказывает отсутствие будущего заполнения диска. Это результат для данного Linux workload, не подтверждение физического
Timeweb хоста. Device IO и inodes сохраняются отдельно; page cache и working set не называются RSS.
Полная история 14/90/365 дней и pgBackRest restore остаются собственными обязательными проверками,
а не экстраполяцией короткого CPU-замера.

## Воспроизведение на отдельном Linux runner

Используется committed checkout, текущие pin, существующие disk admission и storage guard.
Сборка трёх образов регистрирует имена и source identity до приобретения; при ошибке или
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
