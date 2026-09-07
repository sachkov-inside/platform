# Production #355: предварительная проверка

Дата: 7 сентября 2026, 08:26–08:36 UTC. Это начальная диагностика, не разрешение
на выкладку и не подтверждение готовности к пользователям.

Задача: [Platform #355](https://github.com/sachkov-inside/platform/issues/355).
Общий выпуск: [Workspace #137](https://github.com/sachkov-inside/workspace/issues/137).
Telegram: [#45](https://github.com/sachkov-inside/inside-telegram/issues/45).

## Проверенный исходный код и зависимости

Проверен свежий `origin/main` Platform:
`dd64ff7908fa9cf63de88889133993fe3c149c99`. Это основа подготовки, а не окончательный
release candidate: задачи прогресса ещё не завершены.

- GitHub показывает один опубликованный выпуск [v1](https://github.com/sachkov-inside/platform/releases/tag/v1),
  source `188f92ae3bc674ca43a2f4aabbcc454ac22addbf`.
- Нативные блокеры #355: открытые #323 и #184. Для совместной приёмки также нужен
  Telegram #45.
- PR #340 и #342 открыты; чужие ветки прогресса не изменялись. Полный результат
  прогресса сходится в #329. Состояние CI/mergeability не проверялось в этой сессии.
- Между v1 и проверенным main добавлены миграции `0028-series-step-groups`,
  `0029-telegram-sign-in`, `0030-communications-permission`,
  `0031-communication-tracking-hits`. Это сравнение исходников, не чтение live schema.
  Будущий candidate потребует повторной проверки после интеграции прогресса.

Сведения о работающем v1, backup и credentials из
[приёмки #244](https://github.com/sachkov-inside/platform/issues/244#issuecomment-5550726365)
остаются историческими: серверная перепроверка в этой сессии ещё не выполнена.

## Публичный HTTP

Без cookies, авторизации, отправки писем или provider writes:

| Запрос | Обычное разрешение имени | HTTPS через IP из runbook |
|---|---|---|
| `GET https://auth.sachkov.dev/sign-in` | 500 | 500 |
| `GET https://auth.sachkov.dev/oidc/jwks` | 500 | 500 |
| `GET https://auth.sachkov.dev/oidc/.well-known/openid-configuration` | 500 | 500 |
| `GET https://inside.sachkov.dev/` | 200 | 200 |

Проверка через IP использовала `--noproxy '*' --resolve
auth.sachkov.dev:443:201.24.126.23` с сохранёнными hostname/SNI и проверкой TLS;
`ssl_verify_result=0`. Auth отвечал приблизительно за 0,4–0,5 секунды. Обычный
локальный DNS возвращал адреса `240.0.0.x`; результат HTTP 500 воспроизводится и
без этого разрешения имени. Это не проверка из независимой внешней сети.

Повторные JWKS/discovery ответы имеют `Server: Caddy`, тип
`text/plain; charset=utf-8`, 21 байт и одинаковый SHA-256 тела
`e41656eb2ba6c6293bf6dd928e5a88cdbc50535cab661c1969e0f598e497ed62`.
Заголовок Caddy не доказывает, какой компонент породил ошибку.

Дополнительно: публичный `GET /health/ready` Platform — 404;
корень `https://telegram.sachkov.dev/` — 404. Это проверка закрытия конкретных
маршрутов, не внутренняя readiness приложений и не полная проверка firewall.

Минимальное воспроизведение, ожидаемый здоровый статус — 200:

```bash
curl --fail --silent --show-error --max-time 15 --output /dev/null \
  --write-out '%{http_code}\n' \
  --noproxy '*' --resolve auth.sachkov.dev:443:201.24.126.23 \
  https://auth.sachkov.dev/oidc/jwks
```

До исправления возвращает 500 и ненулевой код завершения. После исправления
нужно дополнительно проверить содержимое discovery/JWKS и настоящий вход.

## SSH и следующие диагностические проверки

Независимая сверка host key остаётся обязательным условием из #355. В панели
Timeweb подтверждены Inside App и адрес из owning runbook; открыта серийная
консоль, которая показывает приглашение `inside-production login:`. Доступной
shell-сессии нет. Новый ключ не принят, `known_hosts` не изменён, SSH не запускался.

Вошедший в консоль владелец получает fingerprint командой:

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

После независимой сверки необходимо различить три гипотезы:

1. Caddy не может обработать auth route: запрос к локальному upstream проходит,
   запрос через Caddy падает; безопасная выборка журнала показывает причину.
2. Logto недоступен как процесс: loopback запрос не проходит, состояние контейнера
   и его слушателей это подтверждает.
3. Logto отвечает ошибкой приложения или базы: локальный HTTP тоже возвращает 500,
   целевая выборка журнала и read-only проверка связности с PostgreSQL объясняют её.

Пока ни одна гипотеза не подтверждена. Отказ JWKS/discovery не является
доказательством проблемы Yandex Postbox.

## Подтверждённая разница конфигурации

| Поверхность | Найдено в проверенном main | Что требуется до включения |
|---|---|---|
| Logto image | Production Compose: `1.41.0-inside.2`; Dockerfile и versions.json: `1.41.0-inside.4` | Согласовать шаблон с новой сборкой, собрать и закрепить точный image identity; проверить существующий runtime перед заменой |
| Уникальность Telegram identity | `infra/identity/logto/telegram-identity.sql` применяется только disposable bootstrap | Проверить существующий индекс, валидность и отсутствие дубликатов без вывода identities; включать connector только после разрешённой миграции Logto |
| Logto connector | `enabled`, `issuer`, `platformUrl`, `providerUrl`, `integrationSecret`, `botUsername` хранятся в конфигурации connector | Проверить реальные consumer URLs, issuer и секрет; переменные в `logto.env` сами по себе connector не настраивают |
| JWT и sign-in experience | Bootstrap обновляет custom JWT script с фактическим connector ID; разрешает social sign-in без обязательного email | Сверить production customizer, `blockIssuanceOnError`, connector target и `skipRequiredIdentifiers`; сохранить email-вход |
| Platform API | В production-шаблоне отсутствуют `TELEGRAM_SIGN_IN_ENABLED`, `TELEGRAM_SIGN_IN_PROVIDER_URL`, `TELEGRAM_SIGN_IN_INTEGRATION_SECRET`; default — выключено | Подготовить явные настройки после проверки provider и маршрутов; не включать функцию одним флагом |
| Caddy | Platform допускает evidence и Kinescope, затем возвращает 404 для остальных integrations | Выбрать достижимый путь именно для Logto → Platform `linked-identity`; не открывать все integrations |

Фактические потребители по исходному коду:

- Logto → Telegram: `POST /integrations/identity/v1/sign-in`,
  `POST /integrations/identity/v1/sign-in/{requestRef}/status` и `/consume`.
- Logto → Platform: `POST /integrations/telegram/v1/sign-in/linked-identity`.
- Platform Web BFF → API: `POST /integrations/telegram/v1/sign-in/complete` через
  серверный backend transport. Публикация этого маршрута в Caddy не требуется
  только ради BFF, уже использующего внутренний API.
- Platform API → Telegram: `POST
  /integrations/identity/v1/sign-in/{requestRef}/account-link` для завершения
  подтверждённого входа.

Общий database network не следует считать разрешённой общей сетью прикладных
интеграций. Окончательный выбор закрытой сети или точечных HTTPS routes зависит
от server inventory и согласования с Telegram #45. Production Caddy не изменён.
Disposable `identity-proof-bootstrap.mjs` не запускается на production: он также
настраивает тестовую почту и другие принадлежащие стенду ресурсы.

## Незавершённая приёмка

Текущее решение: **NO-GO для публикации и выкладки**. Нет причины HTTP 500,
сверенного host key, live inventory, окончательного candidate и новой приёмки
backup/schema. Это не запрещает дальнейшую подготовку исходников.

Не проверены на текущем runtime: процессы/ресурсы/права файлов, внутренняя сеть,
DNS у authoritative provider и сроки TLS, schema identity, backup/WAL/timers,
изолированный restore; Postbox From/Reply-To/DKIM/SPF/DMARC, credentials и квоты;
доставка и завершённый email-вход; Object Storage и avatar; Kinescope #184;
Telegram identity/Membership; авторские сценарии и прогресс; operational handoff.

Получатели, identities и disposable media ещё не согласованы. Порог доставки
почты должен быть принят до реальных отправок. Secrets/PII не записываются в
tracker. Объём и порядок итогового GO остаются в #355 и
[production delivery runbook](../runbooks/production-delivery.md).

В этой сессии production/provider mutations, отправки, merge, публикация выпуска
и deployment не выполнялись. Полные application suites не запускались: source
и executable configuration пока не менялись.

Проверка документа: `node scripts/check-agent-documentation.mjs` и
`git diff --check` прошли. Наблюдения сверены с текущими исходниками и ответами
GitHub/HTTP; этот отчёт не меняет спецификацию или архитектурные решения.
