# Production #355: деплой и фактическая приёмка

Дата проверки: 7 сентября 2026, время — UTC. Общая приёмка **не завершена**:
рабочая инфраструктура и отдельные реальные сценарии подтверждены, но обязательные
проверки второго аккаунта, стартового контента и воспроизведения видео ещё остаются.
Мобильный вход и задержка Telegram ведутся в другой сессии; этот проход их не принимает.

Задачи: [Platform #355](https://github.com/sachkov-inside/platform/issues/355),
[Workspace #137](https://github.com/sachkov-inside/workspace/issues/137),
[Telegram #45](https://github.com/sachkov-inside/inside-telegram/issues/45),
[Kinescope #184](https://github.com/sachkov-inside/platform/issues/184).
Владелец разрешил самостоятельное использование существующих доступов,
исправления, merge, деплой и восстановление в рамках #355.

## Текущий runtime и история деплоя

На 21:47:39 UTC production обновлён до **v6**: доменные форматы
и обработка отказа при загрузке видео. Все шесть процессов healthy, схема содержит
36 миграций. Исправление входа
[PR #375](https://github.com/sachkov-inside/platform/pull/375) подтверждено реальными
email и Telegram-сессиями, в том числе обновлением после истечения токена.

| Версия | Исходники | Результат |
|---|---|---|
| [v2](https://github.com/sachkov-inside/platform/releases/tag/v2) | `8204a405089ec85ea450e4ffe6deff62e39cb435` | Деплой 11:04:39; рабочая авторская сессия после возврата 12:25. |
| [v3](https://github.com/sachkov-inside/platform/releases/tag/v3) | `654c60e42453e141b80c21e8eefe34b7a8309848` | Деплой 12:03:32; регрессия выдачи refresh token; возврат на v2. |
| [v4](https://github.com/sachkov-inside/platform/releases/tag/v4) | `7c4131ad4aafe6217c54e3c82992eedc7cbb89c1` | Деплой 13:00:05; реальные email и Telegram-вход и refresh прошли. |
| [v5](https://github.com/sachkov-inside/platform/releases/tag/v5) | `42f086edb6a5086cdffbbfeb613bbf9036089a6b` | Деплой 14:15:27; шесть процессов healthy, сессия и Editor сохранены, новая обложка загружена. |
| [v6](https://github.com/sachkov-inside/platform/releases/tag/v6) | `82fdc092e8d82dd66ac450a5a6fa1f62a6f34eba` | Деплой 21:47:39; доменные форматы, отдельный отказ загрузки, шесть процессов healthy. |

v2: backend `sha256:7682417bc4f16e87b36f2d4714b897f7bbb504d931b6d556b5f9caf4ceb19f9e`,
web `sha256:82126cb22e2b7680a29d16aa0eaa37a3e1b9676ed4a1f372979d3e4722502507`.
v3: backend `sha256:98b4146f663d3847ff11311fe7e2703f7f578d3cd758fd0d08b123912236ead9`,
web `sha256:e85c7ee0cff4fd0ed86082817c6d06df79b7a74ec1d2ce962277a5f9c14346da`.
Обе версии имеют 32 миграции и schema identity
`sha256:15541e8bb388ab75a6f65c5f46e33d00cd9a8438789c087010db31346d8efe21`.

v4: backend `sha256:6750c756661cf8232d34aad57de314445c8380896993f4376212393aa4dd455d`,
web `sha256:fac2ed26ab55f9a8b48d537a46e3046777b478df759e7434c16d83a987803772`.
33 миграции, schema identity
`sha256:029752bf9c6a2cfe1397929a2aa8c0f0e7060a13cf8842d89f917c62292a3ba1`.

v5: backend `sha256:9f7a2e002401ba570eadc700ae4732dddf1edf2487b40d6d7a92bb9dc4a828a2`,
web `sha256:09a92e6ec838cc58b5193210cc6cc9df625b906082b042e9c2b4c71a9ac607b2`.
34 миграции, schema identity
`sha256:d2ba2d71e5c93742388ddca42bd3381aead6c21f3e99a65d2a633a0d29855fdc`.

v6: backend `sha256:96977f7dbe31af1809e968f72d603c58873647fc1082e48f54257853a9946e16`,
web `sha256:4e044ca8cfbeea24fd214f5c05fb33094182298f88e796a23d70ff333cfeb46d`.
36 миграций, schema identity
`sha256:a21454a5f96a141c8c9dbafad6ef9916a4df55b873513d69b76e33c3364a2d7d`.

Workflow evidence:
[v2 release](https://github.com/sachkov-inside/platform/actions/runs/34113479698),
[v2 deploy](https://github.com/sachkov-inside/platform/actions/runs/34114665857),
[v3 release](https://github.com/sachkov-inside/platform/actions/runs/34118823689),
[v3 deploy](https://github.com/sachkov-inside/platform/actions/runs/34119720632),
[rollback v3 → v2](https://github.com/sachkov-inside/platform/actions/runs/34121701513),
[v4 release](https://github.com/sachkov-inside/platform/actions/runs/34123757988),
[v4 deploy](https://github.com/sachkov-inside/platform/actions/runs/34124855384),
[v5 release](https://github.com/sachkov-inside/platform/actions/runs/34130882977),
[v5 deploy](https://github.com/sachkov-inside/platform/actions/runs/34131887519),
[v6 release](https://github.com/sachkov-inside/platform/actions/runs/34163657112),
[v6 deploy](https://github.com/sachkov-inside/platform/actions/runs/34164356131).
Все перечисленные операции завершены успешно. Отдельный ошибочный dispatch
34118665177 был отменён до публикации; повторной версии или скрытого деплоя не было.

Logto обновлён в 15:14:29 до `inside.5`, image
`sha256:f182ffd066bd7ca2674fd791c8e3dff17f558a077eeab6578b5be5da6c59fca6`,
исходники `d74c9740a2322a05ca376fdaed3d95b71cc6a313`
([PR #385](https://github.com/sachkov-inside/platform/pull/385), merge `450d5e93`).
Discovery/JWKS/page/script — 200, существующая сессия сохранила Account и Editor.
Предыдущий `inside.4` image был
`sha256:f18ff8b8030d28182f3cfbcf1c16c4157a0efcda362b67c740f52de7e8906824`. Telegram:
`683ce9ad9a2a7ff9e1eb519a4fd0944a917ed094`, image
`sha256:ca563c614f3556cf7ceac0d483f55461b741e68e5442bb29d26e2d52b01afad4`.
Существующий transport relay сохранён; это внешняя зависимость доставки Telegram.

## Причины отказов и исправления

Первоначальный HTTP 500 на sign-in/discovery/JWKS воспроизводился и через обычный
DNS, и через проверенный IP с сохранёнными hostname/SNI и проверкой TLS.
У Logto отсутствовал CONNECT для рабочих tenant roles после ограничения PUBLIC.
После свежего backup существующей группе `logto_tenant_logto` возвращён только
`CONNECT ON DATABASE logto`. Logto стал healthy; все три маршрута вернули 200.
Platform и Telegram по-прежнему не имеют доступа к чужим базам.
Проверка прав на отдельной восстановленной копии прошла положительный и
отрицательные случаи. Процедура — в [foundation runbook](../runbooks/production-foundation.md).

Новый вход потребовал совместимых Logto/Telegram и точных Caddy routes.
[PR #364](https://github.com/sachkov-inside/platform/pull/364) и
[Telegram PR #50](https://github.com/sachkov-inside/inside-telegram/pull/50)
поставили эти изменения. Произвольные `/integrations/*` не открывались.
Включены только согласованные sign-in flags; communications не активировались.
Telegram connector и custom JWT mapping связаны с фактическим connector ID,
уникальный индекс Telegram identity валиден. Logto остаётся единственным issuer
сессии; успешный Telegram-вход сам по себе не выдаёт Membership.

Первая реальная email-проверка выявила несовпадение API token TTL: Logto выдавал
600 секунд, Platform допускает 300. Через существующий Management API TTL
исправлен на 300; последующая проверка реального токена подтвердила это значение.

v3 принудительно передавал `prompt=login`, заменяя стандартный `consent` SDK.
Logto завершал идентификацию, но без refresh token последующий BFF-запрос
возвращал гостя. Совместимый rollback v3 → v2 выполнен штатным workflow;
авторская сессия на v2 восстановлена. PR #375 передаёт `prompt=login consent`.
Тест строит OIDC URL настоящим SDK из фактических route options; отрицательная
подмена на login-only ломает тест. Контракт дополнен реальным production-доказательством
входа и refresh на v4, приведённым ниже.

## Форматы и загрузка видео: продолжение приёмки

[PR #394](https://github.com/sachkov-inside/platform/pull/394) заменяет управляемый
справочник форматов закрытым доменным набором `video`, `guide`, `note`
(«Видео», «Гайд», «Заметка»). Материал хранит код; отдельная таблица форматов удалена.
Production-проверка работающего v6 подтвердила три значения из кода, отсутствие
таблицы и сохранность существующего материала. Выбор и сохранение формата в браузере
владельца ещё не приняты.

Причиной отказа загрузки был Kinescope token без `upload` scope: uploader возвращал
401. HTTP 200 в Network относился к BFF-ответу редактора, а не к успешной загрузке.
После исправления scope владелец повторил загрузку в 20:31:53 UTC. Промежуточное
ограничение project entity только правом `write` позволило загрузить файл, но прямой
запрос видео возвращал 403. В 21:02:02 token получил `read/write/delete` в `upload`
для двух проектов Platform при сохранении API permissions. Сервисы стали healthy.

Прямой Kinescope GET и действующий Platform adapter на v6 подтверждают `done`,
ожидаемый публичный project, embed locator и длительность 1800 секунд. Агент не
загружал файл вместо владельца и не удалял видео. Подтверждённая старая неудачная
попытка без provider video была архивирована и сброшена адресно после проверки
пустого проекта; успешная попытка сохранена.

[PR #392](https://github.com/sachkov-inside/platform/pull/392) отличает явный отказ
401/403 (`rejected`, `upload_not_authorized`) от неизвестного результата. Новый ключ
разрешён после подтверждённого отказа; неизвестный исход сохраняет защиту от дубликатов.
Миграция 36 не переопределяет старые `unknown` автоматически. Права, состояния и retry
описаны в [runtime runbook](../runbooks/runtime-configuration.md#kinescope-upload-authorization).
CSP warning не установлен как причина загрузочного отказа; `unsafe-eval` не добавлялся.

Итоговые Standards и Spec прошли для обоих PR. PostgreSQL после их объединения:
215 passed в 34 файлах; полный локальный smoke прошёл на отдельных PostgreSQL/Minio.
CI текущих коммитов и повторный CI релиза прошли. Первый CI форматов повторён после
сбоя существующего keyboard-focus сценария Telegram; его код здесь не менялся.
Состояния интерфейса проверены в Storybook при 390 и 1440 px.

На проверке 21:48:42 сохранённого `primaryVideo` у материала ещё нет; Platform хранит
состояние `uploading`, хотя провайдер уже сообщает `done`. Следующий сценарий владельца:
в существующей вкладке «Проверить» → «Сохранить» → «Предпросмотр» → воспроизведение.
Повторная загрузка не нужна. Playback и Membership video не подтверждены;
[#390](https://github.com/sachkov-inside/platform/issues/390) переоткрыта после merge
до выполнения этого условия. #355 и #184 остаются открытыми.

## Реальные пользовательские результаты

| Сценарий | Наблюдение | Граница доказательства |
|---|---|---|
| Email | Новое письмо 11:06 пришло в Gmail INBOX; SPF/DKIM/DMARC pass. Неверный код отклонён. После исправления TTL реальный вход создал Account и показал «Аккаунт». | Около 9,2 секунды от начала действия до получения первого письма; порог заранее не согласован. Остальные провайдеры, expiry и resend не приняты. |
| Email на v4 | Новое письмо 13:03; Account и Editor наблюдались 13:05:38. Reload 13:11:06, спустя 328 секунд, вернул `/auth/status` 200 `authenticated`. | Подтверждена сессия после 300-секундного TTL; остальные почтовые проверки остаются. |
| Telegram на v4 | Запрос создан 13:13:50, approved 13:18:38, consumed 13:18:40; автоматический возврат показал Account и Editor. Reload 13:33:54 вернул 200 `authenticated`. | Реальный вход и refresh подтверждены. Владелец сообщил о минутных задержках; другие статусы Membership не проверены. |
| Telegram linking | Запрос подтверждён 11:55:05; реальный member без `materials:manage` получил проверенное Membership. | Автоматический возврат из приложения не подтверждён. Первый запрос истёк из-за задержки доставки. |
| Telegram sign-in на v3 | Второй запрос approved 12:14:46, consumed 12:14:48. | Полный вход не принят: после callback UI оставался гостем из-за refresh token. |
| Авторские права | Compiled bootstrap на v3 завершён 12:03:57: использован существующий Account, выдан `materials:manage`, повторный запуск — no-op. После rollback доступен Editor. | Это отдельное разрешение; оно не заменяет приёмку обычного подписчика. |
| Editor и файл на v2 | Создан временный неопубликованный черновик; файл загружен, обработан, вставлен, сохранён. После reload и preview файл скачан и побайтно совпал с исходным. | 63 байта, `text/plain`; запрос того же preview asset без авторизации вернул 404 `asset_not_found`. Другой Account и другой Material ещё не проверены. |
| Обложка на v2 | PNG загружен через Editor; в новой вкладке загрузилось обработанное WebP 1×1, 44 байта. Публичный cover endpoint вернул 200. | Проверка технического изображения; замена, очистка, avatar и полная cache-матрица ещё не приняты. |

Технический черновик не публиковался и удалён через Editor. После удаления
обнаружен дефект: каскадное удаление строк обложки потеряло её S3 key, а объект
остался. Исправление [#376](https://github.com/sachkov-inside/platform/issues/376)
слито в [PR #377](https://github.com/sachkov-inside/platform/pull/377): учёт сохраняется
после удаления владельца и при позднем/неопределённом PUT. PostgreSQL — 206 тестов,
Standards/Spec и CI прошли. Исправление развёрнуто на v5.
Единственный технический WebP удалён адресно 13:36:24 после сверки отсутствия
Material/ContentCover и точной SHA-256 с загруженным файлом; последующий HEAD — 404.
Это ручная очистка собственного fixture, а не доказательство работы worker.
Идентификаторы и временные файлы содержатся только в закрытом evidence.
Файл MaterialAsset остаётся в учёте обычного worker с production grace period.

На v5 в 14:16:25 reload подтвердил `/auth/status` 200 `authenticated` и Editor.
Новый неопубликованный технический черновик загрузил PNG; обработанный WebP
отобразился. После удаления черновика через UI база подтвердила отсутствие
Material и сохранённый ContentCover с `upload_confirmed=true` и S3 key.
Это подтверждает сохранение учёта после удаления владельца. Замена через
системный file chooser не завершена; естественная очистка после production grace
period не принята. Файл не удалялся вручную для подмены этого доказательства.

После Telegram-входа Platform автоматически завершает identity binding;
Telegram планирует начальную Membership-проверку, а Platform получает её evidence.
Отдельная ручная привязка для этого входа не нужна. Основание доступа — участие
в canonical group, положительный evidence действителен до пяти минут и обновляется.
Реальный binding 13:18:42 и member evidence 13:18:43 подтвердили этот путь.

Telegram ingress остаётся проблемой приёмки: `getWebhookInfo` неоднократно
показывал `Connection timed out`; владелец сообщил о минутных задержках /start.
После получения обработка занимала около 0,2 секунды, исходящий ответ — менее
секунды. Минутная очередь внутри обработки не обнаружена; источник сетевых timeout пока не доказан.
Параметры webhook и существующий relay сохранены; pending updates не сбрасывались.

Дополнительный локальный full-stack smoke обнаружил гонку ожидания в новом тесте
персональной главной из PR #365: 83 passed, 1 failed, 8 skipped. Исправление
приёмочных ожиданий находится в [#378](https://github.com/sachkov-inside/platform/issues/378);
после исправления полный локальный smoke прошёл. `pnpm check`, focused migrations
и обе проверки кода прошли; [итоговый CI](https://github.com/sachkov-inside/platform/actions/runs/34130108698)
также успешен. Первый CI этой правки выявил timeout нового migration test;
для него установлен тот же предел 15 секунд, что у соседних upgrade-сценариев.

## Замечания другой сессии и мощность сервера

Следующие наблюдения относятся к проходу до 15:19 UTC; мобильный вход и Telegram
latency в этом продолжении не перепроверялись. Их актуальная приёмка ведётся отдельно.

Снимок iPhone с обрезанной кнопкой и жалоба на медленную загрузку сохранены в
закрытом evidence. [#382](https://github.com/sachkov-inside/platform/issues/382)
остаётся открытой: точное обрезание не воспроизведено в WebKit 320/390px,
запрошено название браузера. [#384](https://github.com/sachkov-inside/platform/issues/384)
выделяет подтверждённый сбой: зависший первый запрос статуса не имел предела
ожидания и не повторялся. Теперь ожидание ограничено восемью секундами, после
чего запрос повторяется. Исправление в [PR #385](https://github.com/sachkov-inside/platform/pull/385)
развёрнуто в Logto inside.5; его нельзя считать исправлением снимка до отдельной проверки.
Тест зависшего запроса сначала упал, затем прошли отдельные случаи зависших
заголовков и частичного JSON. Фокусные проверки — 7 passed и 1 условный skip,
Standards/Spec — PASS, полный check и CI текущего коммита прошли. Два CI задания
были повторены после HTTP500 Docker Hub до запуска тестов; повтор успешен.
Задержка /start расследуется в [Telegram #51](https://github.com/sachkov-inside/inside-telegram/issues/51).
Контрольное сообщение запрошено у владельца после недоступности окна Telegram
для native automation; очередь обновлений не сбрасывалась.

До сборки кандидата: 2 CPU, 3910 MiB RAM, доступно 2061 MiB, диск занят на 22%,
memory pressure — 0. Короткая восьмисекундная CPU-выборка дала 61,44% idle и
5,55% steal; длительная нагрузочная ёмкость этим не доказана. Короткоживущие
Node healthchecks дают заметную фоновую нагрузку: одна worker-проверка заняла
1,22 секунды wall и 0,82 секунды CPU, API-проверка — 0,38 и 0,30 секунды
соответственно, при интервале 5 секунд. Сначала стоит снижать эту стоимость и
замерять реальную нагрузку; оснований увеличивать RAM по текущей выборке нет.

Внешние HTTP/2-замеры из текущей сети: HTML входа 0,71–0,76 секунды, скрипт
0,45–0,46 секунды. Это не сеть телефона владельца. Caddy объявляет HTTP/3,
но исходный firewall пропускает на 443 только TCP. UDP 443 добавлен в канонический
provisioning #384 и разрешён на production для IPv4/IPv6. Прямая QUIC-проба из текущей сети истекает за пять секунд;
пакеты не наблюдались на eth0, поэтому внешний HTTP/3 пока не доказан.

## Почта, сеть и конфигурация

Sender — `no-reply@inside.sachkov.dev`, Sachkov Inside; Reply-To не задан.
Выбранный владельцем Yandex Cloud Postbox сохранён. Domain Active, verification
Success, DKIM CNAME Ok; существующий service account имеет `postbox.sender`,
API key ограничен `yc.postbox.send`. Значения ключей не публиковались.
SMTP через TLS вернул 235. Expiration API key не задан; операционная дата ротации
и автоматическое предупреждение не настроены.

Квота при проверке — 200 писем за сутки, 1 письмо в секунду; баланс положительный,
stop-list пуст, исторических bounce/complaints не обнаружено. Это не нагрузочная
приёмка. Платные назначения логов и новые квоты не создавались.

Единственный sender SPF дополнен `include:spf.postbox.yandexcloud.net`, DMARC —
`v=DMARC1;p=none`. К 09:42 новое состояние подтверждено всеми authoritative NS,
1.1.1.1 и 8.8.8.8. Это последующая проверка, заменяющая промежуточный DNS snapshot
09:30. Для письма текущей сессии Gmail подтвердил SPF/DKIM/DMARC pass.

SSH host key независимо сверен через консоль Timeweb:
`SHA256:swAfiGThZt4nibgzRGcB/q1Sr2Y1DA2oCAx6sSTUo34`.
Дальнейший SSH использовал `StrictHostKeyChecking=yes`. Основной checkout и чужие
worktrees не изменялись.

PostgreSQL не публикует порт, API/MCP/Web/Logto/Telegram слушают loopback.
UFW допускает TCP 22/80/443 и UDP 443 для IPv4/IPv6; служебные 2018/10050 не в allowlist.
Отрицательный probe из текущей сети не получил application data на служебных
портах. Вторая независимая сеть и IPv6 не проверены. TLS трёх публичных доменов
валиден, expiry — 4 декабря 2026. Runtime/foundation env принадлежат root, 0600;
transport config — root:65532, 0640. На исходной проверке свободно 41 GiB.

## Backup, миграции и восстановление

Проверка v6 в 21:48:41 подтвердила шесть healthy процессов,
публичные home/discovery/JWKS — 200, WAL failures — 0 и full backup
`20260907-213619F`.

Предыдущая проверка 15:19:55 подтвердила Platform v5, Logto inside.5 и Telegram healthy,
публичные маршруты — 200 и последний full backup `20260907-151926F`.

Full/diff/incremental timers активны, `pgbackrest check` прошёл, WAL failed_count=0
на проверенных snapshots. Перед изменениями создавались новые full backups.

Перед v2 реальный backup `20260907-105115F` восстановлен в отдельный volume.
Проверены базы `inside`, `inside_telegram`, `logto`, применены миграции 28–32,
повторный запуск применил 0 миграций; точная schema identity v2 подтверждена.
Весь proof занял 18,97 секунды. На копии отключён archive, после promotion
отключён исходящий доступ; приложения и live effects не запускались. Временные
контейнеры, сети и volume удалены только после сверки ownership labels.

Перед v4 backup `20260907-124807F` восстановлен в отдельный volume;
миграция 33 применена один раз, повтор применил 0. Точная схема подтверждена,
все временные ресурсы удалены. Проверка заняла 17,61 секунды. После деплоя
все шесть Platform-процессов healthy, HTTP home/discovery/JWKS — 200, WAL failures — 0.

Перед v5 backup `20260907-141004F` восстановлен за 20,09 секунды;
миграция 34 применена один раз, повтор — 0, schema identity подтверждена.
Временные ресурсы удалены. Post-deploy 14:16:07 подтвердил все шесть healthy,
home/discovery/JWKS 200 и WAL failures 0. v5 → v4 несовместим по схеме 34/33.

Перед v6 backup `20260907-213619F` восстановлен на изолированной копии;
миграции 35 и 36 применены один раз, повтор — 0. Хэши содержимого материалов
и всех Video совпали до и после миграции. Точная схема v6 подтверждена, временные
ресурсы удалены; проверка заняла 16.54 секунды. v6 → v5 несовместим
по схеме 36/34; применяется штатный retry/repair-forward.

Перед Logto inside.5 backup `20260907-150705F` восстановлен в изолированной сети.
Схема Platform v5/34 подтверждена без новых миграций; точный amd64 image Logto
дал discovery/script 200 и новый bounded status request. Весь proof — 39,6 секунды,
временные ресурсы удалены. Рабочая замена Logto прошла без изменения схемы.

v3 имел ту же схему, поэтому rollback на v2 был допустим и реально выполнен.
v4 включает уже merged PR #365 с таблицей `reading_activity.material_visits`;
после изменения схемы обещать rollback на v2/v3 нельзя. При несовпадении identity
используется retry выбранной операции или repair-forward по
[delivery runbook](../runbooks/production-delivery.md).

Recovery custody остаётся на Mac владельца с FileVault и существующим recovery
key. Предыдущий снимок 7 сентября зашифрован через age этим ключом: аутентифицированная
расшифровка и SHA-256 всех 144 файлов проверены в 15:34:09. Архив содержит
конфигурацию на тот момент, ключи восстановления, release evidence и фактический
amd64 image Logto inside.5; загрузка image из сохранённого файла подтвердила
точные image/source identity. Незашифрованный промежуточный tar не создавался.
Прежний AES-256 DMG от 6 сентября и его пароль сохранены: обновление DMG
потребовало недоступного автоматизации диалога Keychain. Рабочие базы
восстанавливаются из pgBackRest. Внешняя копия не создавалась; полная потеря
Mac остаётся ограничением выбранного custody.

Актуальный снимок `inside-production-2026-09-08-v6.tar.age` проверен в
21:49:05 UTC 7 сентября (8 сентября по Москве): аутентифицированная
расшифровка и хэши всех 168 файлов совпали. Включены v6 manifest/runtime,
результаты восстановления и деплоя, действующая конфигурация Kinescope и согласованные
с ней encrypted copies. SHA-256 архива:
`3781298d9b17d01c6be9bc81480c57c0516ffa59cc2bc3a3b5e165e386cf4e50`.
Прежние архивы сохранены; незашифрованный промежуточный tar не создавался.

## Краткая передача эксплуатации

Ответственный — Кирилл. Текущие процедуры:
[деплой и retry](../runbooks/production-delivery.md),
[foundation и восстановление PostgreSQL](../runbooks/production-foundation.md).

| Отказ | Как обнаружить | Первое действие |
|---|---|---|
| Login | Discovery/JWKS должны отвечать 200; контрольный реальный вход должен сохранить сессию после reload. | Сверить здоровье Logto, CONNECT tenant roles, API TTL и `login consent`; не считать один HTTP 200 полной проверкой входа. |
| API или worker | Проверить health каждого долгоживущего контейнера и закрытые readiness endpoints. | Сверить текущие image/source/schema с deployment journal; разобрать логи конкретного процесса без вывода credentials. |
| Backup | Проверить systemd timers, свежесть последнего pgBackRest backup, `error=false` и WAL failures. | Разобрать failed unit/repository; до рискованной операции получить свежий успешный backup. |
| Деплой | `state.json` и `operation.json` должны соответствовать выбранному immutable manifest. | Сначала сверить результат незавершённой операции, затем штатный retry; не редактировать journals вручную. |
| Telegram | Проверить webhook pending/error и время между отправкой и получением update. | Сверить ingress и существующий relay; не сбрасывать очередь и не менять webhook по устаревшему snapshot. |

Внешние автоматические уведомления об отказах не настроены. Отдельный monitoring
#245 требует выбора получателя, сервиса и бюджета; ручные проверки не заменяют
постоянный сигнал.

## Что ещё нужно для закрытия #355

- Воспроизвести и проверить исправление обрезанной кнопки на устройстве владельца
  [#382](https://github.com/sachkov-inside/platform/issues/382); повторить реальный
  `/start` с замером этапов доставки в [Telegram #51](https://github.com/sachkov-inside/inside-telegram/issues/51).

- Согласованные почтовые ящики основных провайдеров и порог задержки; expiry/resend.
- Второй тестовый Telegram Account: member/non-member, отзыв и возврат, stale и
  unavailable. Владелец canonical group имеет статус creator и не подходит для
  безопасного удаления из группы; произвольные участники не затрагивались.
- Полная Object Storage-матрица, avatar, замена и cleanup; чужой Account/Material
  и поведение после logout.
- Реальный итог Kinescope #184: видео, policy, callback и проигрывание на
  согласованном media. Проверки конфигурации/отказов не равны просмотру видео.
- Согласованный стартовый контент и авторские publish/update/unpublish, mixed
  Series, порядок, поиск, темы, prev/next, mobile/desktop. Не публиковать WIP из
  Content repository и не заполнять production демонстрационными материалами.
- Прогресс после reload и на другом browser/device, общий Material в двух Series,
  ContentAccess для expired/non-member и очистка персонализации при sign-out.
  Merge #323/#329 и локальные suites сами по себе этого не доказывают.
- Owner functional/visual GO. До него #355, Telegram #45 и общий outcome остаются
  открытыми; этот отчёт не закрывает их автоматически.
