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
| `error` | `type`, `code`, `message`, `stack`, вложенные `cause` и `errors` |

События:

- `dependency_failure` — сбой зависимости в Module: `module`, `operation`, `outcome` (код ответа
  вызывающему), `correlationId` для ответа `internal_error`, `error`;
- `request_completed` — завершение HTTP-запроса `api`: `statusCode`, `durationMs`. Успешные проверки
  здоровья не пишутся;
- `job_failed` — задание воркера завершилось ошибкой, очередь учтёт её как прежде;
- `queue_unavailable` — `pg-boss` потерял базу или свою схему;
- `process_failed` — процесс не запустился или остановился с ошибкой и выходит с кодом 1;
- `worker_stop_failed` — сбой шага остановки воркера после основной причины;
- `nest` — сообщения Nest, в том числе необработанное исключение запроса.

Строки `process_failed`, `queue_unavailable` и `worker_stop_failed` несут
`"status":"operator_attention"`, как и прежние сигналы воркеров.

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
