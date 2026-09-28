# Помощник курса v1 (прототип)

Статус: черновик. Спецификация [#786](https://github.com/sachkov-inside/platform/issues/786);
разделы ниже поставлены в [#787](https://github.com/sachkov-inside/platform/issues/787). Проверка
задания, статусы, спор, разговор, память, evals и приёмка дописываются задачами #788–#791.
Требования курса остаются в ai-engineering `docs/course-assistant.md`, решения владельца — в
ai-engineering `docs/decisions.md` от 27.09.2026.

## Пользовательский результат

Владелец курса на локальном стенде включает помощника курса для своих аккаунтов. Участник из
allowlist открывает `/account/course-assistant`, читает предупреждение о данных, подтверждает его
и подключает репозиторий учебного проекта через GitHub App курса только на чтение. Он видит
подключённый репозиторий, может сменить его или отключить. Если установку удалили на GitHub или
убрали из неё репозиторий, экран показывает, что проверка недоступна, а история связи остаётся.

Остальные аккаунты и стенд без настройки помощника не видят: страница и каждый адрес API отвечают
404.

## Долгая ветка

Прототип живёт в `prototype/course-assistant`: исключение из правила «`main` — единственная долгая
ветка» из `WORKFLOW.md`, принятое владельцем в #786. Управляемый `WORKFLOW.md` не меняется.

- Ветка создана от `origin/main` после merge #785 (`ef20bfdb`).
- Ветка регулярно обновляется merge-коммитом из `main`; PR child-задач направляются в неё и
  сливаются только с разрешения владельца.
- Ветка живёт до решения владельца об интеграции в `main` (отдельная Specification, код за
  выключенной настройкой) или об отказе от прототипа; после решения ветка удаляется.
- CI Platform (`.github/workflows/ci.yml`) запускается для PR в `main` и
  `prototype/course-assistant`. До #787
  фильтр веток пропускал только `main`, поэтому PR в ветку прототипа получал лишь проверку harness.
- Правило защиты (ruleset) есть только у `main` (проверено 28.09.2026 через
  `gh api repos/sachkov-inside/platform/rulesets`: единственный ruleset «Protected main delivery
  branch» включает `refs/heads/main`). Ветку прототипа не защищают обязательный `CI Gate`, merge
  queue и запрет force-push; зелёный CI и разрешение владельца на merge проверяются по процессу.

## Модули и границы

Backend-модуль `course-assistant` (ADR 0004/0005/0029) владеет схемой PostgreSQL
`course_assistant` (ADR 0003). Account хранится непрозрачным UUID без внешних ключей в чужие
схемы. Модуль зависит только от публичного интерфейса Accounts.

### Доступ

- `COURSE_ASSISTANT_ENABLED` (по умолчанию `false`) и `COURSE_ASSISTANT_ACCOUNT_ALLOWLIST`
  (UUID аккаунтов через запятую) решают, открыт ли помощник участнику. Каждая операция модуля
  проверяет это первой и отвечает `unavailable` (HTTP 404 `course_assistant_unavailable`), ничего
  не читая.
- Автор — Account с `platform:admin`. Он видит историю Repository Link всех участников при
  включённой настройке; для остальных этот адрес тоже отвечает 404.
- Настройка не включается в production: конфигурация с `NODE_ENV=production` и
  `COURSE_ASSISTANT_ENABLED=true` не запускается, в production-примерах переменных нет.
- Решение владельца 28.09.2026 (#787) заменяет для прототипа требование #786 о словаре
  `access-capabilities` (ADR 0024): этот словарь описывает только права, которые открывает
  покупка, подписка или мост, и его расширение меняет витрину и выдачу прав. В прототипе участнику
  помощника открывает allowlist, автору — существующее право `platform:admin`. Право участника из
  покупки решается в Specification интеграции в `main`.

### Предупреждение о данных

Версия текста — `currentDataNoticeVersion` в модуле (сейчас `2026-09-28`). Участник подтверждает
именно показанную версию; устаревшая версия отклоняется (`stale_data_notice`, 409). Повторное
подтверждение сохраняет первое. Без подтверждения действующей версии подключение, выбор
репозитория и завершение подключения отвечают `data_notice_required` (403). Новый текст
предупреждения получает новую версию, и участник подтверждает его заново.

Текст: автор видит все чаты, проверки и прогресс; помощник отправляет код из подключённого
репозитория и сообщения участника поставщику языковой модели; курс получает доступ только на
чтение.

### Repository Link

**Repository Link** — связь Account с одним репозиторием через установку GitHub App курса,
которую подтвердил пользователь GitHub этого Account (термин в `CONTEXT.md`).

Подключение:

1. `POST /course-assistant/repository-connections` создаёт одноразовый `state` (32 случайных
   байта), хранит только его SHA-256 и срок 15 минут, и возвращает адрес установки
   `https://github.com/apps/<slug>/installations/new?state=…`.
2. GitHub App запрашивает авторизацию пользователя при установке. GitHub возвращает участника на
   `/api/account/course-assistant/github/callback` с `code`, `installation_id`, `setup_action` и
   тем же `state`. Web передаёт их backend и перенаправляет на страницу помощника с исходом, чтобы
   код авторизации не остался в адресной строке.
3. `POST /course-assistant/repository-connections/completion` принимает `state` один раз и только
   от Account, который начал подключение. `installation_id` из адреса не доверенный: backend
   обменивает `code` на токен пользователя GitHub и проверяет, что установка есть среди
   `/user/installations` этого пользователя. Этот список включает и установки организаций, к
   которым у пользователя есть доступ: проверяется доступ пользователя к установке, а не то, что он
   её создал. Токен пользователя не хранится.
4. Установка с правами шире чтения `metadata`, `contents`, `pull_requests` отклоняется
   (`write_access_requested`, 422). Права сверяются и при каждом получении токена установки:
   установка, чьи права потом выросли, считается отозванной.
5. Подтверждённая установка запоминается за Account. Если она открывает один репозиторий, он сразу
   становится Repository Link; из нескольких участник выбирает сам
   (`PUT /course-assistant/repository-link`).

Смена и отключение:

- У Account не больше одного действующего Repository Link (частичный уникальный индекс). Выбор
  другого репозитория закрывает прежнюю связь (`disconnected_at`) и создаёт новую; тот же
  репозиторий повторно не переподключается.
- Выбирать можно только репозитории установок, подтверждённых этим Account; чужая установка
  отвечает `repository_not_available` (409).
- `DELETE /course-assistant/repository-link` закрывает связь и оставляет её в истории. Установка
  на GitHub не удаляется: участник удаляет приложение в настройках GitHub.

Доступ сейчас: при каждом чтении состояния backend получает токен установки и список её
репозиториев. `available` — репозиторий в установке; `revoked` — установка удалена или
приостановлена (GitHub отвечает 404 или 403) либо репозиторий из неё убран; `unknown` — GitHub не
ответил. Webhook не используется: стенд недоступен из интернета, а отзыв виден при следующем
чтении.

### Хранение

| Таблица | Назначение |
|---|---|
| `data_notice_acknowledgements` | Ознакомление Account с версией предупреждения |
| `repository_connection_attempts` | Отпечаток одноразового `state`, срок, момент использования |
| `github_installations` | Установки, подтверждённые пользователем GitHub этого Account |
| `repository_links` | Repository Link с историей подключений и отключений |

Код репозитория, токены пользователя и установки не хранятся.

### HTTP API

Все адреса требуют Account (`logto`), отвечают `private, no-store` и 404, когда помощник закрыт.

| Операция | Адрес |
|---|---|
| `readCourseAssistantParticipant` | `GET /course-assistant/participant` |
| `acknowledgeCourseAssistantDataNotice` | `POST /course-assistant/data-notice/acknowledgement` |
| `beginCourseAssistantRepositoryConnection` | `POST /course-assistant/repository-connections` |
| `completeCourseAssistantRepositoryConnection` | `POST /course-assistant/repository-connections/completion` |
| `listCourseAssistantRepositories` | `GET /course-assistant/repositories` |
| `linkCourseAssistantRepository` | `PUT /course-assistant/repository-link` |
| `disconnectCourseAssistantRepository` | `DELETE /course-assistant/repository-link` |
| `listCourseAssistantRepositoryLinks` | `GET /course-assistant/author/repository-links` |

`state` помечается использованным до обращения к GitHub: одноразовый код авторизации GitHub тоже
нельзя предъявить повторно, поэтому после сбоя участник начинает подключение заново.

Два одновременных выбора репозитория не создают двух действующих связей: проигравшая запись
упирается в уникальный индекс, и это считается ответом, а не сбоем.

### Web

`/account/course-assistant` в кабинете: предупреждение о данных, подключение, выбор, смена и
отключение репозитория. Раздел не показан в навигации кабинета; точки входа с урока и задания
приходят в #788. Интерфейс — временная семантическая разметка по `docs/agents/frontend-delivery.md`;
визуальный модуль приходит в [#798](https://github.com/sachkov-inside/platform/issues/798).

Адрес возврата из GitHub пока не входит в ограничитель частоты входных маршрутов (`proxy.ts`):
помощник открыт только аккаунтам из allowlist. Включить его туда нужно в Specification интеграции
в `main`.

## Решения, которые допишут следующие задачи

- ADR «GitHub App только на чтение и снимок репозитория по commit SHA без хранения кода» —
  в #788 вместе со снимком репозитория; часть «только чтение» описана выше.
- ADR о доступе к модели через Vercel AI SDK и порт модуля — в #788.

## GitHub App курса

Приложение принадлежит организации `sachkov-inside` и доступно для установки любым аккаунтом
GitHub: учебный репозиторий участника обычно лежит в его личном аккаунте.

- Права репозитория: `metadata`, `contents`, `pull_requests` — только чтение; права организации и
  аккаунта не запрашиваются; события и webhook выключены.
- Авторизация пользователя при установке включена; callback —
  `<origin стенда>/api/account/course-assistant/github/callback`.
- Ключ приложения, client secret и client ID не попадают в Git.

### Включение на стенде

Compose-стенд читает необязательный файл `.course-assistant/stand.env` (вне Git) для `api`:

```bash
COURSE_ASSISTANT_ENABLED=true
COURSE_ASSISTANT_ACCOUNT_ALLOWLIST=<uuid аккаунта владельца>
COURSE_ASSISTANT_GITHUB_APP_SLUG=<slug приложения>
COURSE_ASSISTANT_GITHUB_APP_CLIENT_ID=<client ID>
COURSE_ASSISTANT_GITHUB_APP_CLIENT_SECRET=<client secret>
COURSE_ASSISTANT_GITHUB_APP_PRIVATE_KEY_BASE64=<PEM ключа в base64 одной строкой>
```

Без файла помощник выключен. Включённая настройка без полной GitHub App не запускает API.

## Проверка

- Интеграционные тесты модуля на PostgreSQL (`test/integration/course-assistant.test.ts`) с
  двойником GitHub App: закрытый помощник при выключенной настройке и вне allowlist; порядок
  предупреждения и подключения; подключение, смена, отключение и история; сразу связанный
  единственный репозиторий; отзыв установки и удаление репозитория из неё; отказ по чужому,
  просроченному и повторному `state`; отказ чужой установке и установке с записью; доступ автора.
- Контрактный тест адаптера GitHub App (`test/unit/http-github-app.test.ts`) и HTTP-тест модуля.
- Web: BFF и возврат из GitHub (`test/module/course-assistant-bff.test.ts`), состояния экрана в
  Storybook.
