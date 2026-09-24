# Журнал backend

Каждый процесс backend (`api`, `mcp` и воркеры) пишет журнал строками JSON в stdout и stderr
контейнера. По журналу видно, какая зависимость упала, почему и в какой единице работы.

## Строка журнала

| Поле | Значение |
|---|---|
| `time`, `level`, `event` | время ISO 8601, `info` / `warn` / `error`, имя события |
| `process` | процесс, который пишет строку |
| `requestId` | единица работы: HTTP-запрос `api` и `mcp` или один запуск задания воркера |
| `method`, `route` | метод и шаблон маршрута HTTP-запроса, без параметров и адреса целиком |
| `queue` | очередь задания воркера |
| `error` | `type`, `code`, `message`, `stack`, вложенные `cause` и `errors`; у `notification_transport` — строка «тип: текст» после того же редактирования |

События:

- `dependency_failure` — сбой зависимости в Module (`module: runtime` — проверка готовности
  процесса): `module`, `operation`, `error`; если ответ
  вызывающему несёт код ошибки — `outcome` с этим кодом и `correlationId` для `internal_error`;
- `request_failed` — MCP не смог обработать запрос;
- `request_completed` — завершение HTTP-запроса `api`: `statusCode`, `durationMs`. Успешные проверки
  здоровья не пишутся;
- `job_failed` — задание воркера завершилось ошибкой, очередь учтёт её как прежде;
- `queue_attention` — у очереди `billing-worker` есть несопоставленная или просроченная работа;
- `notification_transport` — наблюдение транспорта уведомлений, с `status` и `reason`; уровень
  `error`, если у наблюдения есть причина. Проход разбора входящих и его наблюдения несут общий
  `requestId`;
- `video_deletion_failed` — удаление видео у провайдера не завершилось окончательно;
- `stored_page_rejected` — сохранённое описание страницы руководства не прочиталось;
- `healthcheck_failed` — проверка готовности воркера в контейнере не прошла;
- `worker_ready`, `worker_draining`, `worker_stopped`, `process_ready`, `mcp_listening` — жизненный
  цикл процесса;
- `queue_unavailable` — `pg-boss` потерял базу или свою схему;
- `process_failed` — процесс не запустился или остановился с ошибкой и выходит с кодом 1
  (соединение, оставшееся после отказа, держит процесс не дольше пяти секунд);
- `worker_stop_failed` — сбой шага остановки воркера после основной причины;
- `nest` — сообщения Nest, в том числе необработанное исключение запроса.

Строки `process_failed`, `queue_unavailable`, `queue_attention`, `worker_stop_failed`,
`video_deletion_failed`, `stored_page_rejected` и тревожные `notification_transport` несут `"status":"operator_attention"`, как и прежние сигналы
воркеров, поэтому прежние `grep` по этому статусу их находят.

## Найти запрос

```bash
docker logs --since 30m inside-platform-production-api-1 2>&1 \
  | grep '"event":"dependency_failure"'
docker logs --since 30m inside-platform-production-api-1 2>&1 \
  | grep '"requestId":"<requestId из найденной строки>"'
```

Вторая команда показывает все строки того же запроса, включая `request_completed` с маршрутом и
кодом ответа. Если участник сообщил код `internal_error`, его `correlationId` ищется тем же `grep`.

## Что не попадает в журнал

Тело, заголовки и параметры запроса не пишутся. Текст ошибок Prisma, драйвера PostgreSQL, разбора
JSON и схемы тоже не пишется: он пересказывает запрос или разбираемый ввод, поэтому у таких ошибок
остаются только тип и код. Из текста остальных ошибок убираются учётные данные в адресах
подключения, параметры адресов, токены, JWT, адреса почты и длинные номера. Правило для кода
описано в [стандарте backend](../../apps/backend/CODING_STANDARDS.md).
