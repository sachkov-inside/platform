# Готовность курса к предзаказу — 18 октября 2026

Это исследование состояния, а не разрешение открыть продажи и не акт полной приёмки. Источники: код Platform `e694eced11738254435b66049e2b57c7491cc146`, текущие GitHub Issues/PR и оригиналы Engineering Content. Исследование оригиналов и кода дополнено read-only проверкой production координатором. В отчёт выведены только агрегаты и технические статусы; секреты, тексты уроков и данные покупателей не включены. Платежи, сообщения, публикации и выкладка не выполнялись.

## Вывод

Техническая возможность продавать курс уже выпущена. Предзаказ использует обычную разовую покупку; отдельного платёжного механизма не требуется. Однако готовность **открыть полноценную продажу пока не доказана**: остаются authentic receipt callback, отложенные возврат/проверки нового покупателя, итоговая сверка Offer и условий, точный пакет последних материалов и принятие незавершённого Reader. Зелёные локальные проверки последнего Reader не заменяют его merge, CI и визуальную приёмку. [Текущий план #854](https://github.com/sachkov-inside/platform/issues/854), [коммерческая приёмка #1359](https://github.com/sachkov-inside/platform/issues/1359), [PR #1440](https://github.com/sachkov-inside/platform/pull/1440).

Запрос «показывать программу, материалы держать закрытыми и позже открывать отдельные» соответствует существующей модели. `access=closed` означает доступ по праву на Product: покупатель с правом читает опубликованный материал, гость видит замок. Это отличается от `draft/unpublished`, которые скрывают материал от обычного ученика. В текущей сессии владелец подтвердил: «Оплатившим доступны все опубликованные уроки; гости видят замки». Это сохраняет существующий контракт. [Контракт доступа](../specifications/content-access-authorization-v1.md), [проекция availability](../../apps/backend/src/modules/content-access/facets/content-access/assemble-content-access.ts), [контент и публикация](../product/platform-mvp-brief.md#контент).

## Что уже подтверждено

| Область | Подтверждённый факт | Ограничение |
| --- | --- | --- |
| Production | Координатор текущей проверки 18.10 перечитал Platform **v39**, source `6460ca4b114eb418a552b72268db945b8fb2fce2`, Telegram **v19**, source `8329fe1fe9575ff3b9be69b2938fb06dd91c9eee`; operation succeeded/complete. Это совпадает с последней записью #854. | Исследователь использует результат координатора; итог полного production verify оформляется отдельно. |
| Приложение | Индивидуальные ссылки #1450/#1501, onboarding #1494, Telegram #1502 уже объединены и выпущены; оферта `/legal/purchase/v6` выпущена с v39. | Повторная реализация не нужна. Старые issue bodies местами ещё говорят о невыпущенной реализации. |
| Контент | 14.10 штатным release preview/apply закрыты **28/28 Materials и 8/8 Tasks**. Гостевой API вернул locked; IDs, тексты, порядок и publication state сохранены. | 18.10 read-only SQL повторно подтвердил 28 published/closed Materials и 8 published/closed Tasks. Это не доказательство переноса оригиналов 18.10. |
| Продажи | Последняя записанная сверка: публичных Offers нет, AIE имеет цену 29 000 ₽, cohort `announcement`, startsOn `2026-11-09`, future price null. | 18.10 read-only SQL подтвердил: Offer unpublished, не архивирован; Option one_time, 2 900 000 копеек. Cohort и индивидуальный quote этой SQL-проверкой не проверены. |
| Реальная покупка | Банк подтвердил отдельную покупку 100 ₽; доступ выдан, покупатель получил чек CloudKassir и purchase email; тестовый Offer снова закрыт. | Application fiscalization pending; полного возврата и свежего buyer/community пути нет. |

Источники: [#854](https://github.com/sachkov-inside/platform/issues/854), [deploy Platform v39](https://github.com/sachkov-inside/platform/actions/runs/38713879786), [отчёт выпуска](https://github.com/sachkov-inside/platform/issues/854#issuecomment-6189144513), [закрытие материалов](https://github.com/sachkov-inside/platform/issues/1427#issuecomment-6167355823), [#1358](https://github.com/sachkov-inside/platform/issues/1358), [#1359](https://github.com/sachkov-inside/platform/issues/1359).

Координатор сообщил для текущего production: доступная RAM 1322 MiB, свободно 8.1 GiB на `/` (84% занято), последний incremental backup завершён успешно `2026-10-18T12:04:42Z`. Это наблюдение запаса ресурсов и истории backup, а не доказательство свежего isolated restore или пригодности к нагрузке продаж. Для реальной выкладки нужны receipts по [release preflight](../runbooks/course-release-preflight.md).

## Последние оригиналы и programme

Канонический репозиторий — `~/Work/Materials/engineering-content`; его роль и пути зафиксированы в [REPOSITORIES.md](../../REPOSITORIES.md). На момент чтения HEAD **`21a4906d474138bc3936e22c6e9ce12880f3e62f`**, 18.10.2026. Последние содержательные изменения включают `8893802a3180b42a30804d3f76bb83479ff22173` (окружение/адаптация процесса), `20e37af916890540549edfda83dc5444b6d7de3b` (pipeline последним уроком главы 1), `277036bbf83896cfbf3dbde864df713e21831c8b` (контекст проекта в репозитории), `8a2d264e17567880580b49fd6a24be7d0420a2ea` (требования заказчика и проверки результата). Источник: `git log` локального checkout; [точный committed programme](https://github.com/sachkov-inside/engineering-content/blob/21a4906d474138bc3936e22c6e9ce12880f3e62f/guides/inside-ai-engineering/guide.yaml).

Программа уже содержит **восемь глав**, а не исторические пять: глава 1 — восемь основных Materials; глава 2 — девять, включая перемещённый `aie-ch1-review`; главы 3–8 имеют описания и пустые `materials: []`. Отдельно сохранены `supplementary_materials` и legacy Task identities. Пустые будущие главы нельзя объявлять готовыми уроками; для предзаказа допустим честный показ плана. [guide.yaml](https://github.com/sachkov-inside/engineering-content/blob/21a4906d474138bc3936e22c6e9ce12880f3e62f/guides/inside-ai-engineering/guide.yaml), [принцип независимой редакционной готовности #1427](https://github.com/sachkov-inside/platform/issues/1427).

В локальном Content checkout имеются чужие изменения `tools/content.py` и untracked preview tooling; они не редактировались и не включались в результат. Нельзя считать вывод изменённого экспортера воспроизводимым только по HEAD. Для выпуска нужно зафиксировать **проверенный committed exporter + Content SHA + exact package/manifest + preview/apply receipt**, сохранив `access=closed` у всех AIE Materials и Tasks. Приватный импорт по умолчанию не публикует материалы и не заменяет уже опубликованные версии. [Граница владения контентом](../product/platform-mvp-brief.md#контент), [поручение #1427](https://github.com/sachkov-inside/platform/issues/1427), [Engineering Content publishing contract](https://github.com/sachkov-inside/engineering-content/blob/21a4906d474138bc3936e22c6e9ce12880f3e62f/docs/publishing.md).

**Конкретная несогласованность для проверки пакета:** FAQ текущего `guide.yaml` говорит «сдаёшь кнопкой “Сдать”», а #1504 закрепляет подтверждение отчёта у агента без кнопки подтверждения черновика на сайте. Нужно согласовать текст с реально выпускаемым workspace, не выдавая старую формулировку за проверенный путь. [Programme FAQ](https://github.com/sachkov-inside/engineering-content/blob/21a4906d474138bc3936e22c6e9ce12880f3e62f/guides/inside-ai-engineering/guide.yaml), [#1504](https://github.com/sachkov-inside/platform/issues/1504).

## Блокеры и недостающие доказательства

| Приоритет | Что осталось | Критерий завершения |
| --- | --- | --- |
| Продажа | **#1447: receipt synchronization.** Полученный чек не отражён в приложении: fiscalization pending, нет fiscalization_confirmed. Причина пока не установлена. | Authentic delivery/config evidence и правильная обработка подписанного callback либо доказанная поддерживаемая сверка; не присваивать confirmed на основании payment_confirmed. Новый платёж для расследования автоматически не нужен. |
| Продажа | **#1358: возврат и права.** Владелец отложил полный возврат; чек возврата, отзыв соответствующих прав и group isolation не приняты. | Возобновлённый владельцем конкретный сценарий полного возврата через кабинет банка, обработка результата и проверка прав; отложенное не обозначается PASS. |
| Продажа | **Свежий learner/buyer path.** Уже привязанные identities не доказывают первую привязку. Тестовый Product не имел community benefit; отдельная AIE activation не доказывает его платную выдачу. | Подходящая согласованная identity, первый вход/привязка, правильный Account, материалы и нужная группа; явные результаты каждой ветки. #1493 сейчас owner-deferred. |
| Последние правки | **PR #1440 / #1504.** На момент GitHub API: head `a06a110b63729532c9dfbe2efe3e53de295f72cb`, draft, CONFLICTING, statusCheckRollup пуст. Последние локальные изменения ещё не выпущены. | Сохранить работу существующего writer, разрешить конфликты/историю миграций, exact-head reviews/checks/CI, финальное production visual GO; затем штатная интеграция и выпуск. |
| Последние материалы | Штатный preview Content HEAD 18.10 завершился с exit 1: `Unsupported requiredFeature: material-task-v1`. Текущий main/production receiver не поддерживает этот пакет; предпросмотр не создан, apply не выполнялся. | Принять точную committed версию и manifest, проверить совместимость receiver; read-only preview, затем authorized apply с сохранением закрытого доступа, IDs/прав/прогресса/сдач/вложений. |
| Финальная настройка | Конкретные Offer/Option, applicable legal edition, Product/community mapping и цены на текущей версии ещё не приняты итоговым актом. | Без списания проверить публичный quote 29 000 ₽ и согласованный индивидуальный 26 100 ₽, условия и ссылки; после обязательной приёмки — отдельное public-sale GO конкретному Offer. |
| Живые переходы | #1399 и новый Telegram backlog 18.10 не закрываются исправлением конфигурации или отдельным коротким наблюдением. Историческая #1512 уже CLOSED после поставки диагностики; текущий failure требует отдельного разбора. | Свежие sign-in success, Account linking, activation/Product/announcement переходы на `sachkov.dev`; служебный T-Bank callback origin сохранить. Зафиксировать действующие FAIL/DEFERRED. |
| История юридических условий | #1464 остаётся открытой по старым согласиям/снимкам, хотя v6 уже опубликована. | Проверить сохранность редакций и прав существующих покупок; не републиковывать старый draft ради закрытия задачи. |

Источники: [#1447](https://github.com/sachkov-inside/platform/issues/1447), [#1358](https://github.com/sachkov-inside/platform/issues/1358), [#1493](https://github.com/sachkov-inside/platform/issues/1493), [#1440](https://github.com/sachkov-inside/platform/pull/1440), [#1504](https://github.com/sachkov-inside/platform/issues/1504), [#1399](https://github.com/sachkov-inside/platform/issues/1399), [#1464](https://github.com/sachkov-inside/platform/issues/1464), [текущая сверка #854](https://github.com/sachkov-inside/platform/issues/854).

Локальные данные #1427 полезны для повторного использования доказательств: `pnpm check`, integration, Storybook, fullstack и before/after hashes 38 защищённых таблиц записаны на точных снимках. Последний полный fullstack `55a1c180…` имеет **176 PASS / 4 declared skips / 2 failures**; последующий test-only `9abdb831` исправляет селектор, шесть focused practice сценариев прошли. Это не зелёный полный fullstack на текущем PR head. [Последний локальный отчёт](https://github.com/sachkov-inside/platform/issues/1427#issuecomment-6197830199).

## Миграции и legacy

Требование чистого production следует проверять как сохранность данных, согласованную schema identity, отсутствие зависимостей от старых checkout и работоспособность обязательных путей. Само наличие миграций или старых IDs не является дефектом: миграции — штатный механизм изменения существующей БД; совместимые identities защищают историю учеников. ADR прямо предусматривает переименования отдельными срезами и redirect старых адресов. Удалять историю или legacy identities ради внешней «чистоты» нельзя. [ADR 0033](../adr/0033-product-tariff-payment-model.md), [границы репозиториев](../../REPOSITORIES.md), [production release](../runbooks/production-release.md).

На исследованном main registry заканчивается `0095_historical_community_coverage`; текущий runtime требует точного соответствия registry/checksums/schema identity, а не отсутствия миграций. Координатор сравнил v39 с main: runtime `src` и migration delta отсутствует, поздние изменения относятся к тестам/tooling/docs. Поэтому новый ordinal только из-за движения main сам по себе не улучшит работающий код. [Migration registry](../../apps/backend/src/migrations/index.ts), [readiness](../../apps/backend/src/infrastructure/operational-readiness.ts).

Последний Reader-кандидат отдельно применял additive `0096_material_task` и schema97 на local stand. Это ещё одна причина сначала согласовать конечный source и миграционную историю #1440; нельзя переносить local ledger в production или обходить migrate, если API отказывает readiness. [Материал Task/local receipt](https://github.com/sachkov-inside/platform/issues/1427#issuecomment-6194742501).

При фактической смене schema identity rollback приложения на старую schema может быть запрещён; нужен repair forward. В обязательном release evidence: final-source coverage, immutable manifest/digests, свежий backup и **реальный изолированный restore**, затем serial deploy и post-deploy verification. Изменение приложения и перенос Content — отдельные операции. [Evidence policy](../agents/release-evidence.md), [course release preflight](../runbooks/course-release-preflight.md).

## Зафиксированные решения владельца

- Старт **9 ноября 2026**, Europe/Moscow. Публичная цена **29 000 ₽**, скидка анкеты после ручной проверки **10%**, итог **26 100 ₽**. Будущая цена не назначена; автоматического повышения нет.
- Материалы и применимая группа Product бессрочны; сопровождение шесть месяцев отражается в применимых условиях. Обычный UI не должен самовольно усиливать обещания сопровождения.
- Предзаказ — обычная покупка с применимой скидкой. Отдельного жизненного цикла/даты окончания предзаказа не требуется.
- Full monitoring stack и delivery incident alerts отложены; это не новый блокер запуска. Существующие passive checks/logs сохраняются; transactional purchase email/callback/доступ остаются обязательны.
- Полная редакционная/образовательная приёмка всех уроков — параллельный процесс; незаконченный курс не блокирует технический выпуск сам по себе. Но порученные последние правки нельзя объявить опубликованными без точной версии и receipt.

Источники: [актуальный #854](https://github.com/sachkov-inside/platform/issues/854), [решения #1359](https://github.com/sachkov-inside/platform/issues/1359), [организация #853](https://github.com/sachkov-inside/platform/issues/853).

## Устаревшие инструкции, которые нельзя применять буквально

[course-release-preflight.md](../runbooks/course-release-preflight.md) ещё содержит старые суммы 29 900 / 26 910 ₽ и схему двух реальных оплат, а также обязательность alert channels. Актуальные owner decisions #854/#1359 заменили эти коммерческие суммы и отложили incident delivery. Из runbook продолжают действовать технические gates и сохранение данных; старые суммы не основание менять каталог или списывать деньги.

[Ранний пакет #1358](issue-1358/README.md) содержит старую незаполненную подготовку до уже состоявшегося теста и прежние инструкции инициировать refund через application operations. Актуальный путь — кабинет банка, сохранённая история и authentic callbacks; не выполнять старый шаблон как новое поручение. [Завершённая интеграция #1433](https://github.com/sachkov-inside/platform/issues/1433), [актуальный план #854](https://github.com/sachkov-inside/platform/issues/854).

## Следующий проверяемый результат

1. Закончить текущий read-only production verdict и инвентаризацию PR; отделить неисправность от устаревшего исторического verdict. Не объединять drafts/prototypes ради количества закрытых PR.
2. Получить от текущего writer #1427 exact accepted UI/source и точный Content package, совместимый с выбранным receiver. Последовательно закрыть их проверки, конфликты и визуальную приёмку.
3. Доказать receipt callback и заполнить недостающий buyer/refund ledger с сохранением явных отсрочек. Личные банковские/identity действия остаются конкретной работой владельца.
4. Если выбранный runtime отличается от production — пройти технические release gates и verify; отдельно применить принятый Content package с закрытым доступом и видимой программой.
5. Подготовить конечную карточку Offer/Option/benefits/legal/quotes. После успешных обязательных критериев запросить только конечное решение **открыть конкретную продажу**. Подготовка, merge, deploy, Content publication и public-sale GO отражаются отдельно.

Отчёт не устанавливает новых продуктовых условий и не заменяет существующих владельцев #854/#1427. Непроверенные production сценарии остаются непроверенными.

## Свежая проверка production — 18.10, 17:12–17:14 UTC

Команды выполнены из Platform `e694eced11738254435b66049e2b57c7491cc146` после `pnpm install --frozen-lockfile` с pinned Node 26.10.0/pnpm 11.27.1. Первая попытка verifier до установки зависимостей дала `not_checked`; её не считаем проверкой сервера. Затем:

| Проверка | Фактический результат |
| --- | --- |
| `python3 scripts/production-verify/verify.py --application platform --version v39 --host inside-production` | exit **1**: 17 passed, затем `billing-worker worker errors` failed; штатный fail-fast остановил остальные проверки. |
| Дополнительный non-failfast сбор теми же `verify_platform` функциями | 58 проверок: 57 passed, 1 failed (`billing-worker worker errors`). Это диагностика, а не успешная приёмка. API/Web/MCP readiness, образы, остальные workers, broker, очереди, доменный каталог и watchdog прошли. |
| `python3 scripts/production-verify/verify.py --application telegram --version v19 --host inside-production --telegram-observe-seconds 30` | exit **1**: 33 passed, затем lifetime error counters failed. Дополнительное наблюдение также failed: evidence backlog **769** в обеих пробах. |
| Lifetime counters Telegram | reconciliation failure **8**, degraded **8**; остальные проверяемые error counters и unknown effects **0**. За 30 секунд счётчики не росли, процесс не перезапускался, readiness была нормальной, новых error logs не было. Это не устраняет backlog. |
| SQL очереди Telegram | **769** `retry_scheduled`, `diagnostic_code=platform_http_503`, attempts **7–625**; **18 395** delivered; отдельно **3** rejected/409 и **252** rejected/422. Последующий read-only разбор связал все 769 retries с одной `registering` привязкой без принятия terms и account binding; receiver сознательно отвечает 503. Не очищать очередь и не переигрывать callbacks вручную. |
| Billing worker logs | Два `queue_attention` в `community.entitlement-delivery` 17.10 01:13/01:14 UTC (overdue/unapplied=1); один `dependency_failure` 18.10 15:36 UTC, `telegram-membership.exchange`, TimeoutError. Это реальные наблюдения, не доказанная причина всех 769 retries. |
| Финансовый агрегат | Одна production purchase `confirmed` / fiscalization `pending`. Никаких новых оплат или возвратов не выполнялось. |
| Existing CI access | Production access pass [39110967295](https://github.com/sachkov-inside/platform/actions/runs/39110967295), 18.10, success. Это прежний provider run, а не новый полный buyer journey этой сессии. |
| Passive monitor | [39147122017](https://github.com/sachkov-inside/platform/actions/runs/39147122017), 18.10, success. Его успех не отменяет failures более глубокого verifier. |

Безопасные JSON diagnostics сохранены в `.reports/preorder-readiness-20261018/{platform-v39,platform-diagnostic,telegram-v19}.json` в текущем worktree. Это локальные receipts, не CI и не свежий restore proof. Методы сборщика: [production verifier](../../scripts/production-verify/verify.py), [backlog SQL](../../apps/telegram/src/modules/membership-evidence/membership-reconciliation.ts), [delivery retry](../../apps/telegram/src/modules/membership-evidence/membership-evidence-outbox.ts).

## Инвентаризация открытых PR

Снимок GitHub 18.10.2026. Ни один PR не удовлетворял всем требованиям немедленного merge. Наличие успешного старого CI в конфликтующей draft-ветке не доказывает готовность интегрированного результата.

| PR | Состояние и следующий шаг |
| --- | --- |
| [#1535](https://github.com/sachkov-inside/platform/pull/1535) | Ready, CI Gate success; изменение полномочий агентов high risk, явное принятие готового `e89c1b24` владельцем ещё требуется. Не относится к runtime курса. |
| [#1365](https://github.com/sachkov-inside/platform/pull/1365) | Ready, конфликты, failures Unit/Telegram/CI Gate. Не объединять до исправления и свежих checks. |
| [#1440](https://github.com/sachkov-inside/platform/pull/1440) | Последние Reader/Task правки; draft, конфликты, checks отсутствуют на `a06a110b`; сохранить существующего writer и завершить приёмку. |
| [#1500](https://github.com/sachkov-inside/platform/pull/1500), [#1409](https://github.com/sachkov-inside/platform/pull/1409), [#1379](https://github.com/sachkov-inside/platform/pull/1379) | Сохранённые prototype-ветки. #1500 прямо запрещает main merge; реализация коммерческой функции уже выпущена отдельно. Не включать прототипы в production. |
| [#1439](https://github.com/sachkov-inside/platform/pull/1439), [#1333](https://github.com/sachkov-inside/platform/pull/1333), [#1322](https://github.com/sachkov-inside/platform/pull/1322), [#1312](https://github.com/sachkov-inside/platform/pull/1312) | Draft, failures и/или конфликты; каждый требует собственного завершения, старые diagnostics не включать автоматически. |
| [#1339](https://github.com/sachkov-inside/platform/pull/1339), [#1313](https://github.com/sachkov-inside/platform/pull/1313), [#995](https://github.com/sachkov-inside/platform/pull/995) | Draft и конфликты несмотря на старый зелёный CI. Требуют сверки с уже поставленным поведением; legal draft #995 нельзя публиковать поверх принятой редакции по одному факту CI. |

## Подготовленный порядок запуска

1. Закончить [#1536](https://github.com/sachkov-inside/platform/issues/1536): ограниченный lifecycle evidence для незавершённого первого входа. Штатный путь восстановления конкретного Account — личное принятие terms и authenticated resume; агент не может выполнить согласие за пользователя. Для заброшенной регистрации нужны проверенные expiry/terminal outcomes без потери evidence и выдачи прав. После изменения проверить штатный worker и повторить verifier; исторические failures сохранить.
2. Закончить именно #1440: конфликты, совместимость migrations, exact-head CI/review и визуальная приёмка. Иначе последний committed Content с `material-task-v1` перенести нельзя.
3. Повторить штатный Content preview на точном committed SHA, проверить состав восьми глав, removals, media/artifacts, закрытый доступ. После разрешения только конкретного плана выполнить apply и сверку IDs/прав/прогресса. Результат failed preview не применять.
4. Закончить #1447 по authentic банковским данным. Отдельно разрешить или явно пересмотреть owner-deferred refund/first-link критерии; старое разрешение на тест не назначает новую оплату.
5. Если есть принятый runtime delta, собрать immutable release с exact-source checks, свежим backup и isolated restore; объявить maintenance и выполнить штатный deploy. По предыдущему v39 maintenance занял 40 секунд; для новой схемы оценка должна учитывать её миграции, это не обещание того же времени.
6. На выбранном production проверить guest locks, оплаченный Product, приватные файлы/видео, login, Telegram, quote 29 000 / 26 100 ₽, оферту v6 и обещания предзаказа. После обязательной приёмки открыть только согласованный Offer; материалы остаются closed.

Текущий результат: анализ и технические доказательства подготовлены; merge, новая публикация версии, production deployment, Content apply и открытие продаж в этой сессии не выполнены. Причины — конкретные failures, несовместимый Content receiver и незавершённые обязательные приёмки, а не отсутствие общего поручения на подготовку.

Дополнительная диагностика #1536: отдельное двухминутное наблюдение API дало 412 HTTP 503 и 3 HTTP 200 на membership-evidence. Все 769 ожидающих evidence связаны с одним `registering` link от 16.10; provider refs присутствуют, terms acceptance/account binding отсутствуют. [Первый вход](../../apps/backend/src/modules/telegram-membership/features/complete-telegram-sign-in/telegram-account-sign-in.ts) сохраняет промежуточное состояние до принятия условий; [receiver](../../apps/backend/src/modules/telegram-membership/facets/telegram-membership/assemble-telegram-membership.ts) для него возвращает unavailable. Это объясняет текущие отказы; это не массовый отказ покупок. Идентификаторы аккаунта, secret refs и payload остаются вне отчёта.
