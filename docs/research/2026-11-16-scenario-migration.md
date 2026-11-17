# Перенос сценарных данных и подмен web

Задача [#2246](https://github.com/sachkov-inside/platform/issues/2246), решение №1 из [#2244](https://github.com/sachkov-inside/platform/issues/2244). Здесь записаны поддерживающие шаги audit1, не закрытие всего audit1 или audit2.


## Конечный inventory audit1

Эта таблица заменяет прежние промежуточные списки остатка ниже, но не заменяет итоговую живую проверку. Граница inventory зафиксирована исходными четырьмя семействами: 20 fixture-файлов Storybook (из них 17 в `src/storybook` на исходной ревизии), три прежних local seed, основной Navigation backend и четыре выбранных E2E interception-потребителя. Дополнительно разобраны их фактические эквивалентные потребители, включая inline Story inputs, выделенные HTTP adapters, histories/overview/sales/reference/authoring. Число файлов и строк описывает размер исходников, не число дубликатов. Поиск одинаковых строк сам по себе не расширяет набор синтетических сущностей.

`migrated` означает, что существовавший эквивалентный потребитель читает общий факт через свой адаптер. `independent` означает другой учебный случай, событие, авторский текст либо самостоятельное тестовое ожидание. `not-applicable` означает, что эквивалентного потребителя в этом семействе не было. Наличие факта в `scenarios` отдельно от подключения потребителя не считается миграцией. Общий источник здесь означает владельцев синтетических фактов в `scenarios`, а не один огромный файл и не единое представление для всех транспортов.

| Владелец фактов | Storybook | Изолированный seed и прежний CLI | Navigation HTTP | Playwright interception | Фактическая доставка |
| --- | --- | --- | --- | --- | --- |
| `reading.mjs`, 120 материалов и явный полностью открытый вариант | `product-journey-corpus.fixtures.ts`, migrated | `seed-reading-feed.mjs`, migrated: 120 через Content interfaces, вне Product, ADR-0043. Прежний CLI каталог имеет другую identity | `reading-http.mjs` и performance/Home consumers, migrated | `test/support/reading-interception.ts`, 18 видимых карточек, migrated | PR #2250 и #2304 merged |
| `learning.mjs`, Product, главы, четыре урока, artifact, прогресс, закладка, task versions/submissions/feedback и словарь | `learning.fixtures.ts`, migrated | `seed-learning.mjs`, migrated через настоящие owning interfaces | `learning-http.mjs`, migrated | `test/support/learning-interception.ts`, migrated | PR #2260, #2295, #2304 merged |
| `roles.mjs` | Account/People/commerce adapters, migrated | light role assembly, real Accounts resolution, migrated | synthetic actor labels, migrated | learning/commerce adapters, migrated | PR #2260 и #2283 merged. Subject роли не выдаётся за реальный Account UUID |
| `commerce.mjs`, pending order, accepting Intake и явное вступление learner | `commerce.fixtures.ts`, migrated | `seed-commerce.mjs`, SalesFunnel interface и доверенный composition entrypoint, migrated | `commerce-http.mjs`, migrated | `test/support/commerce-interception.ts`, migrated | PR #2271 и #2283 merged. Нет auto-join, настоящего списания или отправки сообщений |
| `people.mjs`, контакты, названия продуктов, directory/card/history и явные варианты | `people.fixtures.ts`, buyers в `owner-payments.fixtures.ts`, migrated | not-applicable: роли нового light имеют другие записи | `people-backend.mjs`, migrated | not-applicable: отдельного эквивалентного каталога нет | PR #2273 и #2332 merged |
| `payments.mjs`, продукты и две матрицы платежей | `owner-payments.fixtures.ts`, migrated | independent: новый pending commerce order является другой записью | `sales-payments-backend.mjs`, migrated | not-applicable | PR #2273 merged. Story detail/refund histories самостоятельны |
| `overview.mjs` и уже общие People labels | `admin-overview.fixtures.ts`, migrated | not-applicable: реальные агрегаты нового light не подменяются отчётной fixture | `authoring-overview-backend.mjs`, migrated | not-applicable | PR #2332 merged |
| `legacy-catalog.mjs` и `legacy-assets.mjs` | `home`, `billing`, `buyer-journey` и соответствующие inline Story inputs, migrated | `seed-local-development.ts` и `seed-local-offer-catalog.ts`, migrated для того же каталога/asset markers. Новый light их не вызывает | metrics читает общее reading name; иной старый курс independent | not-applicable: URL/assertion literals являются ожиданиями | PR #2278 и #2314 merged. Общий CLI #2267 остаётся отдельным ограничением |
| `lesson-interactions.mjs`, attempt/statistics/ratings и именованные варианты | `lesson-statistics.fixtures.ts`, migrated | not-applicable: fingerprint не превращён в полное Exercise definition | not-applicable | Отдельного E2E набора нет. Дополнительные реальные HTTP module consumers `exercise-attempts-bff` и `lesson-rating-bff` migrated другим владельцем | PR #2301 и #2310 merged; независимые literal expectations сохранены |
| `legacy-task-submissions.mjs`, три reviewed snapshots и отдельный четвёртый HTTP variant | прежний публичный `task-submissions.fixtures.ts` adapter, migrated | independent: новый learning Task имеет другую identity/definition | `legacy-task-submissions-http.mjs`, migrated; прежний ручной JSON удалён после полного сравнения | not-applicable: существующие Nav tests обращаются к HTTP | PR #2325 merged. Дополнительные module consumers принадлежат audit2 |
| `course-references.mjs`, два справочных Material slug/title | `course-reading.fixtures.ts` и inline MaterialReader Story input, migrated | not-applicable | `fake-backend.mjs` reference lessons, migrated | not-applicable: нет отдельного эквивалентного массива | PR #2340 merged |
| `sales-catalogue.mjs`, 25 Product, три общих Promotion с вариантами, respondent names и anchors | `sales-catalog.fixtures.ts`, migrated | not-applicable: это прежний sales preview, другой pending commerce order | `sales-catalog-backend.mjs`, migrated | not-applicable | PR #2343 merged, `9198f58f16e71701339e5b725d39dabfbdcf1cc7` |
| `authoring.mjs`, те же c011 Products и review Material/Topic metadata | not-applicable: ProductSale Story имеет другой Product/название | not-applicable | `content-collections`, `product-sale`, `authoring-materials`, `authoring-search` adapters, migrated в этом срезе | not-applicable: отдельные route/URL assertions независимы | #2335, доставка и итоговая проверка pending |

### Конечные исключения и уточнение 37 кандидатов

Исходный список 37 совпадающих строк был вспомогательным поиском на ревизии `53df65c4`, а не доказательством 37 семантических дубликатов. Его категории уточнены по identity и владельцу события. Категория «факт уже общий, потребитель ещё ручной» закрыта фактическим подключением Overview/metrics в #2317/#2299; одно наличие прежнего `peopleScenario` этого не доказывало. Равное название `Инженерная практика` в `billing.supportOffer` обозначает подписку на материалы/поддержку/сообщество с другим Offer, а не тот же lifetime Product из People/Overview; этот billing пример independent.

- `Архитектура приложения` в collections/search/sale относится к одному c011 Product и переносится в #2335. People/Overview c011…102 и отдельные счётчики доступа являются другим учебным состоянием, без объединения identity/цен/прав.
- `Разработка с агентами` в Materials/search является общей Topic metadata (#2335). Product платежей с таким названием имеет другой вид сущности и остаётся independent.
- People Anna `joinReminders.lastAt` 24 октября и `telegram.observedAt` 26 октября общие между Story и HTTP (#2317). Material publication и Overview purchase events в тот же час являются другими событиями. Sales link creation 26 октября отдельно принадлежит #2334. Action clock 27 октября общий между sales adapters, но равный ему `Funnel.generatedAt` сохранён отдельным временем отчёта.
- `Поток весна 2027` у People practice Intake общий в #2317. Overview AI Intake, его active count и Product являются другим набором. Одного равного заголовка недостаточно для переноса.
- Chapter `Продолжение` в Reader Story и Nav принадлежит разным главам/продуктам. Он independent. Справочные Material `aie-project`/`aie-product-brief` общие в #2333. CustomerBriefDownload имеет явный заголовок `Проект курса`, а `inside-content-aie-product-brief` обозначает другой artifact/content URL.
- People manual histories сохраняют Story issue 11 июня, restore 20 августа, revision 3 и HTTP issue 2 сентября без restore, revision 2. Directory population и распределения, Overview ряды/периоды, respondent второй timestamp (+час против +дня), raw UTCZ/+03 даты и sales Promotion scope/usage/revision остаются явными вариантами, а не заново написанными копиями общего факта.
- `product-task.fixtures.ts` хранит учебный snapshot программы 5 октября и versioned criteria. Review queue хранит другое короткое название/критерии для того же демонстрационного task code, новый learning Task имеет свою identity. Эти разные учебные состояния не заменяются друг другом. Историческая версия не вычисляется из текущего определения.
- `ai-engineering-course.fixtures.ts` (#1909, принятый текст 31 октября) и `product-page.fixtures.ts` (#671) являются снимками авторского контента. Они independent, не новый synthetic dataset и не runtime-зависимость от соседнего checkout. `customer-brief.fixtures.ts` сохраняет отдельный download пример.
- Account profile/avatar, notification preferences, billing contact, отдельные legal/error/retry fixtures, `payment-links.fixtures.ts` individual link и unique product-sale states являются самостоятельными контрактными случаями. Они не объявлены общими лишь по совпадению UUID, чисел, дат или UI labels. Действительные ссылки между Story fixtures уже используют import/spread исходного владельца.
- Bookmarks module contracts остаются independent: `bookmarks-bff.test.ts` задаёт projection `bookmark-me`/`Закладка` с датой 7 сентября, `bookmarks-browser.test.ts` проверяет wrapper/account cache с датой 10 сентября без того же именованного Material. Равный opaque UUID не устанавливает общую Material identity. Learning/reading bookmark относится к другому Product. Эти файлы и их HTTP migration принадлежат audit2, в audit1 они не менялись.
- Четыре исходных E2E interception consumers сохраняют самостоятельные protocol/auth/error/mobile cases. Повторяющиеся Offer101/Option201 в subscription return-from-bank и Story materials Offerf01 имеют разные identity/benefits. Learning, commerce и reading adapters подключены там, где это тот же именованный сценарий; независимые expected URLs/text/amounts не читают проверяемый mapper.
- Настоящие backend-only unit/integration fixtures сохраняют независимые доменные данные. `seed-local-stand-accounts.ts` принимает настроенные subjects/issuer и выдаёт grants для найденных Products, а не содержит копию новых synthetic role profiles. Он не вызывается новым isolated light. Его общий CLI путь и #2267 этим переносом не объявлены исправленными.

В этом конечном inventory не осталось назначенного ручного эквивалентного потребителя без владельца переноса. Последний срез #2335 выше пока имеет отдельные delivery gates. Это утверждение относится к разобранным четырём семействам и конкретным эквивалентам, не к «нулю похожих литералов во всех тестах». Independent/not-applicable случаи перечислены явно. Новые каталоги ради совпавшего UUID или числа не создаются.

### Счётчики и границы доказательств

| Ограниченный состав | До | После переноса |
| --- | --- | --- |
| 120 reading Material | Три ручных массива Story/Nav/interception | Один владелец, отдельные адаптеры и открытый вариант; новый seed четвёртым потребителем |
| People contacts, Product labels, payments | Два ручных каталога и два генератора; buyers повторялись отдельно | People owner и payments owner с явными вариантами; три потребителя контактов |
| Legacy catalogue, 24 выбранных scalar fields | 88 объявлений в выбранном составе | 24 объявления владельца (#2299) |
| Lesson interactions | Story и два module HTTP input набора | Один facts owner, три реально подключённых потребителя (#2298/#2310) |
| Legacy reviewed submissions | Два ручных набора трёх snapshots и metadata | Один owner, отдельный четвёртый HTTP variant (#2313) |
| People/overview, 26 выбранных fields | 72 объявления | 26 (#2317) |
| Reference metadata, четыре поля | 15 объявлений | Четыре (#2333) |
| Sales, 17 выбранных fields | 35 объявлений | 17 (#2334) |
| Authoring metadata, девять выбранных fields | 24 объявления | Девять (#2335) |

Счётчики не складываются в глобальный процент: составы и единицы разные, generic flags, явные варианты, чужие сущности и независимые assertions исключены. Структурные проверки 2880 assertion/locator nodes и 53 Reader play functions подтверждают сохранность кода ожиданий, но не заменяют реальные Story/Nav/HTTP/PostgreSQL запуски и fault RED/GREEN. Каждый supporting PR хранит собственные evidence и immutable SHA.

Audit2 передан другому владельцу. Исходный AST baseline на `8f740ecf` равен 164 действительным direct calls, 135 internal и 124 shared; прежние 166/136/125 были текстовыми совпадениями с комментариями. Audit1 не мигрирует module mocks, его mock delta равна нулю. Итоговые after counts и исключения mock guardrail предоставляет audit2. Промежуточный снимок 133/104/94 на `20703bec` не выдаётся за итог.

### Итоговая проверка после доставки

Живая проверка итогового audit1 ещё требуется после actual merge всех implementation срезов на точном integrated main. Предыдущие 22 populated сценария #2297/PR #2304 от 17 ноября являются историческим доказательством своего HEAD и не включают unavailable. Новый manifest должен подтвердить свежую изолированную БД без legacy `db:seed` и fixed720 Product, роли, библиотеку/continuation/filters, paid/free lessons и extra Material/inline artifact, started/completed ProductAccess, bookmarks, task current/old versions/submission/AuthorFeedback, dictionary и owner People/payments/waitlist. Separate Story/Nav unavailable/empty/denied/outdated cases сохраняются; неподнятый outage не считается живой проверкой. Нужны role-appropriate screenshots/короткое видео, evidence manifest, наблюдённые побочные эффекты и очистка только собственных ресурсов. Исторические неизменные proof используются повторно с точной привязкой; изменённые или непокрытые границы проверяются заново. Whole-app/UI pilot и общий замер после интеграции audit1+audit2+frontend остаются у координатора.

## История поддерживающих шагов

Ниже сохранены состояния на момент каждого шага. Их слова «пока» и старые количества не являются текущим остатком; текущий inventory приведён выше.

## Четыре прежних источника

| Источник | До первого шага | После первого шага |
| --- | --- | --- |
| Storybook | `product-journey-corpus.fixtures.ts` вручную создавал 120 материалов | Читает общие факты через свой адаптер представления |
| Локальный seed | `seed-local-development.ts`, `seed-local-offer-catalog.ts`, `seed-local-stand-accounts.ts` | Прежний seed пока независим; новый test-only seed читает 18 общих материалов и вызывает доменные интерфейсы |
| Navigation backend | `fake-backend.mjs` вручную создавал 120 performance-материалов | Этот состав читает общий HTTP-адаптер; семь основных lessons и остальные именованные сценарии пока независимы |
| Playwright interception | `mobile-navigation.spec.ts` вручную создавал 18 карточек | Читает общий состав через отдельный BFF-адаптер |

Для перенесённого большого состава было три ручных объявления, стало одно в `scenarios/reading.mjs`. Новый изолированный seed добавляет четвёртого потребителя этого источника. Прежние четыре семейства данных целиком ещё не перенесены. Истории платежей, людей, заданий, словаря и остальных продуктов пока содержат свои факты; backend-only fixtures не тронуты.

## Границы первого шага

`scenarios/reading.mjs` задаёт синтетический продукт, тему и 120 материалов с чередованием видео и гайдов, тремя открытыми уроками и последующими закрытыми. HTTP, Storybook, Playwright и persistence имеют отдельные адаптеры. Явный вариант открытого состава сохраняет прежние полностью открытые performance-курс и mobile-ленту; preview и seed сохраняют открытые и закрытые уроки. Тема navigation определена в том же источнике и совпадает с его маршрутом. Адаптер seed использует только первые 18 материалов и работает с `inside_test_<32 hex>` базой, сверяет фактическое имя подключённой базы и не собирает банк или доставку сообщений. Он не подключён к общему стенду или production.

Persistence выдаёт собственные идентификаторы и slug через реальные интерфейсы и возвращает соответствие идентификаторам сценария. Даты публикации отражают настоящий вызов публикации. HTTP-адаптер использует синтетические идентификаторы и даты. Эти отличия относятся к адаптерам, а не к повторному определению названия, доступа или формата материала.

Тесты берут ожидаемые значения из явных примеров. Они не вызывают проверяемый mapper, чтобы построить ожидаемый результат. Web-тест проходит через настоящие schema и `toMaterialPreview`; интеграционный тест публикует материалы через authoring и читает через Content Library. Браузерные сценарии сохраняют проверки количества карточек, фильтров, восстановления позиции и ссылок; названия и ссылки теперь следуют общему составу.

## Согласованность старого материала в isolated seed

Issue #2267 воспроизвёл отдельный дефект исходных данных: два узла старого материала `kak-ustroen-inside-platform` ссылались на несуществующие assets. Сохранение одного заголовка через настоящий API получало 422. `scenarios/legacy-assets.mjs` теперь задаёт эти маркеры, подписи и синтетические байты SVG и текстового файла. Старый backend seed читает общие маркеры; отдельный `seed-legacy-assets.mjs` загружает bytes через настоящий owning upload API и сохраняет выданные ID полным авторским Save. Этот адаптер вызывает только контроллер своего свежего light instance после подготовки ролей, до объявления ready.

Повтор использует тот же upload idempotency key и не увеличивает Content Version, когда документ уже согласован. Метаданные, публикация, подписи и прочие узлы сохраняются; отправка уведомлений явно выключена. Доступ к файлам остаётся прежним: гостю файл из программы недоступен, владелец скачивает настоящие bytes. Изолированные адаптеры обучения и assets используют общий клиент, который отказывает обычному имени базы и внешнему origin до первого запроса. Имя базы само по себе не доказывает владение, процесс и базу связывает вызывающий контроллер.

Этот шаг исправляет только fresh isolated light setup. Старый CLI seed общего стенда не загружает эти assets, остальные его данные ещё независимы. Production и общий стенд этим адаптером не заполняются. Это ограничение нельзя выдавать за завершённый перенос всех прежних фактов или за исправление общего стенда.


## Подмены до и после

Исходный список прямых вызовов записан в [машиночитаемой инвентаризации](2026-11-16-web-mock-inventory.json), срез `6979ea42a8365619f3a369162ffa7202bbb653c5`. Сканировались все отслеживаемые файлы `apps/web`; это подсчёт прямых AST-вызовов `vi.mock`, а не обещание уже проверить каждый возможный способ подмены. Прежний лексический поиск дал 166 совпадений, включая два комментария в `next-cache.ts` и `vitest.config.mts`; они сохранены отдельно как исторический результат, но исключены из числа вызовов.

| Подсчёт | До | После первого шага |
| --- | ---: | ---: |
| Все прямые `vi.mock` | 164 | 164 |
| Внутренние `@/` | 135 | 135 |
| Из них `@/shared` | 124 | 124 |

Новые тесты собственные модули не подменяют. Audit2 ещё не начат, его запрет пока не добавлен. Требуется отдельно проверить relative imports, aliases конфигурации, `vi.doMock`, spies и ручные подмены; одних этих счётчиков для завершения audit2 недостаточно.

## Остаток после первого шага

Перенести остальные факты и роли, наполнить главы, дополнительный материал и артефакт, ProductAccess с начатым и завершённым уроком, закладки, Task Version, Submission и AuthorFeedback, словарь, платежи, людей и ожидание набора. Сохранить отдельные empty, denied, unavailable и outdated-version. Подключить полноценный seed только к изолированному стенду и подтвердить названные состояния свежей браузерной проверкой с manifest, снимками и коротким видео. Затем завершить audit1, смержить и начать audit2.


## Второй шаг: изолированное обучение

Общие роли находятся в `scenarios/roles.mjs`. Их читают подготовка ролей light instance, тест настоящего API и Storybook-профиль покупателя. Прежний доступ к демонстрационному продукту сохранён. Новый `scenarios/learning.mjs` задаёт вымышленный курс из четырёх материалов: три основных урока в двух наполненных главах, отдельный дополнительный материал и третью пустую главу. Он также задаёт бесплатный скачиваемый файл, завершённый и начатый уроки покупателя, закладку, термин словаря, Task Version 2, текущую и устаревшую сдачи и отзыв автора к текущей.

| Потребитель | Адаптер и фактическое использование |
| --- | --- |
| Storybook | `learning.fixtures.ts`, история `Synthetic learning/Started`, настоящий `ProductProgrammeView` с контекстами чтения и продолжения |
| Изолированное приложение | `seed-learning.mjs`, запуск контроллером light instance после создания Accounts; настоящие loopback HTTP domain entrypoints |
| Navigation | `learning-scenario-backend.mjs`, общий HTTP-адаптер `learning-http.mjs`; проверка программы на production Web в desktop и mobile Chromium |
| Playwright interception | `learning-interception.ts`, самостоятельная проекция BFF для библиотеки с выбранной темой; desktop и mobile Chromium |

Эти адаптеры не выводят факты или ожидаемые значения из проверяемого web mapper. Отдельный тест применяет настоящий mapper к HTTP-проекции и сравнивает результат с буквальными названиями, количеством глав, составом и доступом. Seed проверен через настоящий API, PostgreSQL и RustFS, включая чтение байтов файла. Он отказывает до первого запроса при обычном имени базы, внешнем origin и неверном пути API. Контроллер связывает порт своего процесса с собственной базой `inside_light_<10 hex>`; интеграционный тест использует собственную `inside_test_<32 hex>`. Сам переданный databaseName не удостоверяет содержимое чужого процесса: seed вызывается только этими владельцами ресурсов.

Persistence выделяет идентификаторы продукта, материалов и артефакта и создаёт slug по своим правилам. Адаптер возвращает соответствие ключей материала реальным ID. Идентификаторы глав задаёт сценарий через поддерживаемый авторский интерфейс. Синтетические HTTP/Storybook/BFF ID, slug и даты остаются проекцией. Актуальная и устаревшая версии задания существуют одновременно, без подмены одной другой. Покупатель получает ProductAccess; участник без покупки читает teaser платного урока без его тела. Пустая глава и отдельные существующие denied/unavailable/empty истории не удалены.

Этот шаг добавляет общий учебный сценарий, но ещё не переносит прежние факты платежей, людей, ожидания набора, редакционные задания реального курса и весь демонстрационный seed. В частности, `seed-local-{development,offer-catalog,stand-accounts}.ts` по-прежнему независимы; новый seed дополняет их только в изолированной базе. Объявлять завершённый один источник для всех четырёх прежних семейств пока нельзя. Для нового учебного состава один набор фактов обслуживает четыре вида адаптеров; у ранее перенесённых 120 карточек остаётся одно базовое объявление и явный открытый вариант. Подсчёт прямых AST-вызовов vi.mock после второго шага по-прежнему 164/135/124; audit2 ещё не начат. Полная живая проверка всех обязательных состояний audit1 с manifest и визуальными доказательствами остаётся обязательной.

## Метаданные справочных материалов

Issue #2333 переносит четыре общих поля двух глобальных Material в
`scenarios/course-references.mjs`: slug и название описания проекта и брифа заказчика.
Их читают три фактических потребителя: `course-reading.fixtures.ts`, входные данные
истории Reader и reference lessons навигационного HTTP backend. Ссылка из тела урока
и выбор справочного материала также используют общий slug. Ожидаемые подписи, адреса
и DOM selectors существующих тестов остаются буквальными и независимыми.

| Семейство | Фактический результат среза |
| --- | --- |
| Storybook | Собственный courseSource и inline supplementaryMaterial берут metadata из одного источника, сохраняя physical ID, доступ, главы и контекст чтения. |
| Navigation fake backend | Собственная HTTP-проекция сохраняет 9 шагов, 2 именованных справочных документа и 4 дополнения, тела и членство в Product. |
| Изолированный seed | Не применимо к этому прежнему курсу. Новый light сохраняет другие learning/commerce факты и не получает ещё один демонстрационный Product ради паритета. |
| Playwright interception | Самостоятельной эквивалентной копии этих metadata не было. Существующие navigation specs читают настоящий HTTP double. |

AST-инвентаризация на базе `8d2766602d1c595667398302d8de1f594c8eedff` насчитала
15 литеральных записей четырёх выбранных полей в этих входных сценариях и одну запись
каждого поля после переноса, всего 4. В число не входят expected labels/paths, полные
строки route URL и разные названия других материалов. Все 53 прежние функции `play`
из изменённого Reader Story сохраняют нормализованный AST; это структурное дополнение
к настоящим проверкам интерфейса, а не ещё один поведенческий тест.

Вариант CustomerBriefDownload сохраняет название «Проект курса» и отдельный адрес
`inside-content-aie-product-brief`; одинаковый slug его отображаемого материала использует
общий источник, а другое название не подгоняется под него. Подпись главы «Продолжение»
принадлежит разным Chapter в разных Product, поэтому прежний широкий literal candidate
уточнён как независимая подпись, а не незавершённый перенос тождественной главы.

До изменения сохранён весь немаппированный courseSource и 8 HTTP-ответов на публичное
и авторизованное чтение программы/материалов. После переноса все поля совпадают с базой.
Этот срез не меняет production mapper, права, Product model или внешний контракт и не
завершает итоговую живую проверку всего audit1. Sales/authoring metadata, окончательная
таблица четырёх семейств и current integrated manifest остаются отдельными этапами;
ограничение общего CLI #2267 сохраняется.

## Третий шаг: общие факты людей и платежей

`scenarios/people.mjs` теперь задаёт три именованных контакта, шесть имён для длинного списка, дополнительные имена покупателей и четыре продукта People. Storybook и navigation читают их через свои существующие адаптеры. Длинное название архитектурного продукта в Storybook сохранено явным вариантом, короткое название navigation тоже сохранено. Пространства синтетических ID остаются разными проекциями. Подпись владельца в обоих адаптерах читает общую вымышленную роль; имя настоящего владельца больше не является фактом этих сценариев.

`scenarios/payments.mjs` задаёт пять продуктов платежей и явные варианты их названий, состояния, суммы, даты, доступ, сведения снимка цены и тестовое окружение. Storybook сохраняет свой состав из восьми чередующихся состояний и четырёх цен, navigation сохраняет 60 платежей, первый unknown и выдачу preparing у четвёртого. Эти варианты принадлежат одному источнику, а не двум заново написанным генераторам в адаптерах. Отдельные адаптеры формируют presentation и HTTP contract. Ни тестовые ожидания, ни проверяемые production mapper не служат источником ожидаемого результата.

| Перенесённая группа | До этого шага | После этого шага |
| --- | --- | --- |
| Именованные контакты People | Два ручных объявления в Storybook и navigation; имена покупателей повторялись ещё в платёжной fixture | Один источник People, три потребителя |
| Названия четырёх продуктов People | Два ручных каталога | Один каталог с явным длинным вариантом |
| Продукты платежей, суммы, даты и состояния | Два независимых генератора с разными сценарными матрицами | Один источник с двумя явными вариантами; два адаптера |
| Подпись владельца People | Два объявления настоящего имени | Общая синтетическая роль |

Сохранены существующие проверки поиска, фильтров, пагинации, карточки, grant/revoke/restore, stale revision, empty/denied/unavailable и unknown payment. История возврата, события и журнал отдельного платежа пока остаются Storybook-only данными. Истории доступа и даты карточек People, длинные списки и их схемы распределения также ещё не перенесены. Коммерческий isolated seed и route interception пока не потребляют новые People/Payment facts. Прежний local seed, включая дефект ссылок на assets из #2267, этим шагом не исправлен. Поэтому общий audit1 по-прежнему частичный, один источник всех прежних фактов не объявляется завершённым. Прямые AST-вызовы vi.mock остаются 164/135/124, их миграция не начата.


## People и авторский обзор

Issue #2317 переносит общие входные данные карточки Анны и обзора в facets
`people.mjs` и `overview.mjs`. Прежние контакты и названия продуктов уже принадлежали
`peopleScenario`; теперь их действительно читают и оба адаптера обзора. Наличие общего
факта и перенос его потребителя здесь считаются разными результатами.

| Семейство | Перенесённые потребители и границы |
| --- | --- |
| Storybook | People card/list и overview fixtures читают общие даты, оплаты, учебный прогресс, сведения Telegram и активного ожидания набора. Overview сохраняет свои длинные подписи и отдельные ряды значений. |
| Navigation fake backend | Отдельные People/Overview HTTP adapters используют те же факты. Mutable access records, команды, фильтры, курсоры и состояния ответа остаются на своей границе. |
| Изолированный seed | Не применимо к этим прежним карточкам и агрегатам. Новый light использует собственные роли и настоящие learning/commerce записи; эти примеры не записываются поверх них. |
| Playwright interception | Самостоятельной эквивалентной копии карточек и обзора не было. Существующие navigation specs вызывают настоящий fake HTTP backend. |

AST-подсчёт 26 вручную выбранных эквивалентных полей на базе
`0a37769863a05a8271f3baa53e0d33c8f06a6204` даёт 72 объявления до переноса и 26 после,
по одному на поле. В число входят даты карточки и общего шаблона истории доступа,
два directory epoch, суммы двух оплат, read/total прогресса, reporting day, сумма продажи
обзора, число обладателей и средний прогресс AI-продукта, часовой пояс и один username.
Общие состояния, физические ID, типовые объявления, ожидания тестов и несвязанные события
с тем же числом или датой исключены. Это измерение среза #2317, не всех дублей audit1.

История отозванного доступа остаётся двумя разными примерами: Storybook сохраняет выдачу
11 июня, восстановление 20 августа и revision 3; navigation сохраняет выдачу 2 сентября
и revision 2 без восстановления. Их общий пример отзыва использует одну дату и причину.
Длинные списки разделяют пул имён и фиксированные epochs, сохраняя разные составы,
индексы и распределения состояний. Архитектурный продукт в обзоре по-прежнему имеет
12 начавших и progress 0.18 в Storybook, а navigation показывает 0 и null. Ряды продаж,
воронка, количество событий и их даты также остаются разными примерами.

Сезонная подпись набора AI-продукта в Storybook overview и подпись ожидания другого
Product в People не доказывают тождество Product Intake. Они не объединяются по тексту.
В смешанных прежних literal candidates дата reminder относится к People, а такая же дата
публикации материала или покупки обзора остаётся другим фактом; дата наблюдения Telegram
также не заменяет время создания sales link. Общий календарный день не связывает эти события.

До редактирования сохранены все поля 64 ответов настоящего HTTP fake backend и варианты
Story fixtures, включая длинные списки и периоды 7/30/90 дней. После переноса они совпадают
с исходными значениями. Прежние Story и navigation test oracles не меняются и проверяются
отдельно. Это не новая проверка прав backend и не итоговый manifest всего audit1.
Остаются sales catalogue, reference metadata, эквивалентные authoring metadata consumers
и окончательная таблица четырёх семейств. Ограничение общего CLI #2267 сохраняется отдельно.


## Четвёртый шаг: коммерческий состав изолированного учебного сценария

[#2279](https://github.com/sachkov-inside/platform/issues/2279) дополняет тот же учебный Product
сценарием ожидающей оплаты за 14 900 ₽, связанного Telegram-профиля участника и его явной записи
в принимающий Product Intake. `scenarios/commerce.mjs` импортирует Product из `learning.mjs` и
имя из `roles.mjs`. В нём находятся сумма, состояние, набор, вымышленный Telegram-профиль и
детерминированные данные представления. Синтетические presentation ID и даты не выдаются за ID
или время реальной persistence. Ни адаптер, ни production mapper не вычисляет тестовые ожидания.

| Потребитель | Адаптер |
| --- | --- |
| Storybook | `commerce.fixtures.ts`, истории Pending Purchase и Linked Learner с настоящими PaymentsTableView и AuthoringPeopleView |
| Изолированное приложение | `seed-commerce.mjs`, настоящие Account, legal consent, Telegram linking, ProductWaitlists, pricing, quote и purchase HTTP interfaces; создание Product Intake через доверенную локальную composition |
| Navigation | `commerce-scenario-backend.mjs` и `commerce-http.mjs`; отдельный токен сценария, остальные denied/empty/unavailable маршруты сохранены |
| Playwright route interception | `commerce-interception.ts`; самостоятельная BFF-проекция, навигационная проверка повторно открывает платежи с перехваченным внешним ответом |

Локальные провайдеры реализуют внешние HTTP-протоколы. Они не заменяют собственные доменные
модули. Изолированный seed не пишет бизнес-таблицы через Prisma и не добавляет production HTTP
hook. Поддерживающий интерфейс создания Intake поставлен отдельно в PR2271. Набор создаётся
до явного `join` от Account, а не вместе с автоматической подпиской. Банк получает только Init;
ожидающая оплата не выдаёт ProductAccess. Покупатель с уже открытым учебным продуктом сохраняет
свои начатый и завершённый уроки, сдачи и отзыв. Маркетинг провайдера остаётся stopped.

Для нового коммерческого сценария есть одно объявление фактов и четыре вида адаптеров.
Это не завершение переноса прежних четырёх семейств: прежние People/Payment генераторы ещё
содержат даты и истории, прежний local seed сохраняет независимые бизнес-факты, а старые
редакционные задания и дополнительные варианты ожидают следующего шага. Настоящие backend-only
фикстуры остаются независимыми. Прямые AST-вызовы vi.mock по-прежнему 164/135/124; новых подмен
собственных модулей этот шаг не вводит. Полная проверка всех именованных populated-состояний
и миграция audit2 остаются обязательными.


Свежая проверка коммерческого состава выявила и исправила расхождение почтовой проекции.
Sign-in Email позволяет Account попасть в People и служит источником адреса заказа, но поле
PersonIdentity.email берётся только из подтверждённого Billing Contact. У этого учебного участника
Billing Contact не подтверждён. Общий факт `commerceFixtureFacts.billingEmail` поэтому явно равен
`null`; все preview adapters сохраняют имя Telegram и @username без раскрытия email входа.
Новая парная API-проверка независимо подтверждает `email:null` в People, `contact:null` в собственном
Billing Contact и настоящий адрес заказа через отдельный защищённый owner read. Прежние проверки
закрытого урока, права holder и исторических версий задания сохранены.

## Пятый шаг: файл внутри дополнительного материала

Issue #2291 связывает уже созданный учебный Product Artifact с памяткой. Общий источник
`learning.mjs` теперь задаёт подписи двух разделов, инструкцию проверки, объявленный источник
файла, материал размещения и подпись скачивания. Прежняя Task Version и список связанных
материалов также заданы здесь, вместо вычисления версии внутри seed adapter. Технические
ID, provenance и HTTP-проекции остаются обязанностью адаптеров.

Изолированный seed использует существующий Markdown codec и разрешает только объявленную
`artifact:result` ссылку из памятки. В сохранённом документе находится same-origin source route
с настоящим Product ID. Ссылка не закрепляет Content Version файла. Настоящий Reader сам
получает актуальные metadata и проверяет доступ через существующую доставку. Программа не
получает раздел или новую кнопку артефактов.

Storybook независимо строит reader presentation из тех же текстов. Navigation HTTP adapter
отдаёт публичный контракт Reader и Products, а отдельный Playwright adapter отдаёт файл на
границе внешнего HTTP-ответа. Проверки содержат явные ожидаемые подпись, source ID, имя и
байты файла. Прежние проверки глав, free/paid, ProductAccess, прогресса, словаря, сдач и отзыва
сохранены. У недоступного платного урока нет тела.

Этот шаг не завершает перенос старого local seed, редакционных сценариев и оставшихся
People/Payment histories. Он также не исправляет общий CLI из #2267. Инвентаризация выше
сохраняет эти ограничения; завершение всех четырёх прежних семейств пока не заявлено.

## Шестой шаг: общие снимки попытки и статистики

Issue #2298 создаёт `scenarios/lesson-interactions.mjs`. Он владеет прежними Material ID,
Exercise ID, fingerprint, правильной попыткой, датой и двумя явно разными составами статистики.
Это авторские снимки версии, полное определение упражнения по fingerprint не восстановлено
и не придумано. Настоящие backend-only exercise fixtures остаются независимыми.

Storybook читает свой состав через отдельный presentation adapter. Его прежние 12/3 оценки,
40 ответивших, 55%, старая версия с 18 ответившими и 28%, подписи вариантов и пустое второе
упражнение сохранены. Module/HTTP вариант сохраняет 3/1 оценки, 4 ответивших и прежние сведения
о первой попытке. Проверка настоящих frontend schemas принимает оба вида данных; прежние
Story assertions заданы литералами. Намеренно выбранный в Story неправильный module вариант
оценок приводит к падению неизменённой проверки, правильный Story вариант проходит.

Два старых module consumers, `exercise-attempts-bff.test.ts` и `lesson-rating-bff.test.ts`,
принадлежат отдельному исполнителю audit2. Их переход на настоящий HTTP и последующий импорт
этого источника выполняются в его PR. До их фактического merge они остаются в инвентаризации
как ещё не переведённые на общие факты. Добавление источника само по себе не превращает три
прежних объявления fingerprint в одно. Прежние denied/error/cross-origin assertions этого
исполнителя не меняются здесь.

## Седьмой шаг: common seed без старого бизнес-каталога

Issue #2297 убирает `db:seed` из light startup. После свежих миграций и доверенного bootstrap
владельца Accounts, legal acceptance и profile создаются настоящими интерфейсами. Общие роли
больше не содержат физический ID старого Product. Доступ holder выдаёт существующий learning
adapter к Product, который только что создал настоящий import interface.

`seed-reading-feed.mjs` публикует 120 общих `openReadingMaterials` через reserve/apply API,
с темой `navigationReadingTopic`, двумя форматами и явным `inFeed:true`. У этих материалов нет
Product association: ADR0043 допускает в ленту только бесплатные материалы вне Products.
Отдельный learning Product сохраняет платные и бесплатные уроки, главы, дополнительный материал
с файлом, ProductAccess holder, progress/bookmark/dictionary, версии задания, сдачи и feedback.
Commerce adapter сохраняет pending purchase, People и явную запись в принимающий Intake.

Новый integration case обходит настоящий cursor страницами по 12 без пропусков и повторов,
проверяет 120 материалов, по 60 для Video/Guide, и пустой feed для темы Product. Ожидания
записаны литералами. Прежние проверки учебного и коммерческого состояния сохранены. До добавления
адаптера case получал HTTP200 и totalCount0, после него получает120; прежние12 cases проходят.
Отдельный role contract до исправления фиксировал лишний grant к старому720 Product, после
исправления все8 contracts проходят. Это не обещает, что runtime уже проверен свежим браузером;
проверка полного populated instance и manifest остаётся отдельным обязательным этапом поставки.

Граница четырёх семейств потребителей после #2297:

| Общие факты | Storybook | Изолированный seed | Navigation fake backend | Playwright interception |
| --- | --- | --- | --- | --- |
| Reading120 | Перенесены, preview120 | Перенесены, real API open-feed120 | Перенесены, open-course120 | Перенесены, open-feed18 |
| Learning и роли | Перенесены, programme и reference Reader | Перенесены, реальные learning interfaces | Перенесены, Product/Reader/file HTTP | Перенесены, catalog и file response |
| Новый pending commerce | Перенесены | Перенесены, реальные Accounts/Billing/Sales Funnel | Перенесены, отдельный scenario token | Перенесены, BFF payment projection |
| Прежние People/Payment | Имена, продукты и матрицы перенесены; card histories частично ожидают переноса | Новый learner case отличается от прежней Anna matrix | Имена/матрицы перенесены; card histories частично ожидают переноса | Новый commerce перенесены; прежние card variants не заявлены |
| Legacy catalogue | Повторяемые имена/описания ещё ожидают #2299 | Не применимо для common light; старый CLI остаётся отдельным legacy consumer до2299 | Собственные отличающиеся course cases не приравниваются к legacy catalogue | Не применимо |
| Lesson interaction snapshots | Перенесены | Не применимо, frontend-only snapshots | Не применимо, два module HTTP consumers принадлежат audit2 | Не применимо |

Разные роли, закрытые/пустые/недоступные и устаревшие состояния остаются отдельными сценариями.
Таблица не требует равенства всех wire shapes или полной Storybook parity. Backend-only
fixtures остаются независимыми. Повтор одинаковой даты в двух разных сюжетах сам по себе не
доказывает общий факт; оставшиеся People histories, overview, sales catalogue и reference facts
требуют ручной проверки владельца и смысла.

Старый development CLI и регрессионные тесты legacy asset repair сохраняются отдельно. Отсутствие
shared CLI uploads из #2267 не объявляется исправленным; default light больше не использует этот
каталог и не запускает repair. До переноса эквивалентных старых consumers и окончательной живой
проверки общий audit1 не завершён.

## Каталог продаж и скидки

Issue #2334 переносит тождественные входные данные Story/HTTP каталога в
`scenarios/sales-catalogue.mjs`. Один источник задаёт три именованных Product, параметры
22 дополнительных карточек, три общих примера Promotion и отдельные варианты представления.
Адаптеры сохраняют настоящие frontend PriceSnapshot/Promotion interfaces и свои HTTP envelopes.

| Семейство | Фактическое применение |
| --- | --- |
| Storybook | Каталог 25 продуктов, три общие скидки, имена участников анкеты и общие опорные моменты берутся из общего источника. Уникальные предзаказ, первые покупатели, Black Friday и New Year остаются самостоятельными примерами. |
| Navigation fake backend | Отдельные HTTP projections используют те же входы; изменяемые links/promotions, команды, фильтры и курсоры остаются локальными. Funnel повторно использует имена своих Product по тем же ID. |
| Изолированный seed | Не применимо к этому прежнему каталогу цен. Новый light сохраняет свой learning Product и pending commerce пример, без дополнительных демонстрационных Product. |
| Playwright interception | Самостоятельного эквивалентного каталога здесь нет. Navigation читает действительный fake backend по HTTP. |

На базе `fec2ada9fa8d226bad575bbfcc7d7c1cdb8de307` AST-подсчёт 17 выбранных
эквивалентных скалярных полей даёт 35 литеральных записей до переноса и 17 после,
по одной на поле. Scope включает имена, суммы, параметры хвоста каталога, имена
участников и три общих опорных момента; прежние Date.UTC учитываются как объявление
момента. Generic flags, ID/revisions, варианты дат/подписей и несвязанные одинаковые числа
исключены. Это измерение ограниченного среза, а не всех дублей audit1.

Различия сохранены явно: длинная подпись агентного продукта и короткая navigation;
редакция цены 2 у Story и 3/1/2 у трёх именованных navigation Product; 3 продукта в
осенней Story скидке и 2 в navigation; alumni usedCount 1240 против 140; архивный
Tribute ID 11 против 3. Даты сохраняют прежние строковые формы и годы, без нормализации
UTC/Z и смещения +03. Распределения ссылок, totals и объём анкеты тоже различаются.
Три общих имени и первый issuedAt переиспользованы, но второй issuedAt остаётся разным:
Story сдвигается на час, navigation на день. Дата создания ссылки не заменяет generatedAt
отчёта воронки, даже когда прежние строки совпадают.

До редактирования записаны все поля каталога/скидок и вариантов Story links 0/1/7/50,
а также actual HTTP ответы. После добавления чтения respondents сохранённый расширенный
набор из 24 ответов сохраняет все прежние 22 ответа без изменений; само чтение respondents
до переноса совпадало с неизменённым исходным handler. Девять Story read responses включают
forbidden/unavailable. Ожидаемые значения тестов не берутся из production mapper, прежние
UI assertions не меняются. Данные и интерфейс проверяются раздельно.

Это не новая коммерческая модель, изменение цены/доступа или операция настоящего банка.
Полная живая проверка исходного audit1 и итоговый manifest на integrated main остаются
обязательными; прежние foundation22 не доказывают этот срез. Остаток authoring metadata
#2335, окончательная таблица четырёх семейств и ограничение CLI #2267 сохранены отдельно.

## Общие факты прежнего каталога

Issue #2299 переносит тождественные входные данные прежнего каталога в
`scenarios/legacy-catalog.mjs`. Это Product, названия предложений, обзорный и закрытый
материалы, три видео и общий текст иллюстрированных карточек. Разные подписи Developer
Pipeline и адреса двух видео сохранены как явно названные development/illustrated варианты.
Существующий адрес обзора принадлежит `legacy-assets.mjs` и переиспользован, а не объявлен снова.

| Прежнее семейство | Фактическое применение этого среза |
| --- | --- |
| Storybook | Отдельные Home/billing/buyer adapters и входные данные inline stories импортируют общие факты. Прежние физические ID, стоимость, состояния, распределение тем и размеры иллюстраций остаются у соответствующих вариантов. |
| Backend seed | Старые development catalogue/offer adapters импортируют те же факты. Их самостоятельный workflow сохранён. Новый default light из #2297 использует другой согласованный reading/learning/commerce состав и от этого старого каталога не зависит. |
| Navigation fake backend | Metrics adapter читает уже общий reading Product name. Прежний legacy catalogue здесь не объявлялся; придумывать для него паритет не требуется. |
| Playwright interception | Для этого legacy catalogue нет самостоятельного набора ответов. Существующие route probes и literal href expectations служат проверкой маршрута, а не копией данных каталога. |

AST-инвентаризация 24 выбранных строковых фактов на исходном `20703becc` насчитала
88 объявлений входных данных, после переноса 24, по одному на факт. В число не входят
числовые длительности, общие подписи тем, route contexts, регулярные выражения и независимые
ожидания. Это измерение ограниченного среза, не число всех семантических дублей audit1.
Три длительности видео также перенесены, а независимые записи с тем же числом 754 и другими
названиями не подогнаны под эти видео. Нормализованные AST всех прежних expect/locator/assertion
calls в 13 изменённых Story-файлах сохранены, 2880 узлов; это проверка сохранности исходников,
а не дополнительный поведенческий тест. Проверки UI и настоящего seed выполняются отдельно.

Остаются прежние People histories/dates и часть overview/sales/reference consumers.
Issue #2313 отдельно владеет прежними reviewedSubmissions и HTTP JSON навигации; новые
учебные Task facts не заменяют их иной сюжет. Два interaction BFF consumers перенесены
исполнителем audit2 в PR2310, фактический merge `3c83b4d9b5620a0cbfd56d6181861a2b14111cf9`
от 2026-11-17. Их основные входные снимки теперь импортируются из общего источника;
независимые ожидаемые значения и ошибочные варианты сохранены.
Общий CLI сохраняет отдельное ограничение assets из #2267. Полный перенос четырёх семейств
и завершение audit1 этим срезом не объявляются.

## Старые снимки сдач

Issue #2313 переносит прежние снимки авторской проверки в
`scenarios/legacy-task-submissions.mjs`. Этот сюжет сохраняет свой Product, две главы,
два задания, три исторические версии требований и три персоны. Он отличается от нового
`learningScenario.task`, поэтому версии, критерии и идентичности этих сюжетов не объединяются.

| Прежнее семейство | Фактическое применение этого среза |
| --- | --- |
| Storybook | Типизированный адаптер прежнего `task-submissions.fixtures.ts` собирает три сдачи и сохраняет публичные экспорты, фильтр без комментария и длинные страницы. |
| Backend seed | Не применимо для старого авторского списка. Default light сохраняет собственные реальные текущую/старую сдачи и AuthorFeedback из learning facts. Backend-only регрессии независимы. |
| Navigation fake backend | Отдельный `legacy-task-submissions-http.mjs` собирает прежний HTTP envelope. Его потребитель проверяет настоящий транспортный schema; ручной JSON удалён после полного сравнения с исходным снимком. Дополнительная четвёртая сдача через форму сохранена как явный вариант. |
| Playwright interception | Отдельного эквивалентного набора здесь не было. Navigation tests читают настоящий fake backend по HTTP; новый route interception ради паритета не добавляется. |

До переноса одни и те же три снимка и их справочные данные поддерживались вручную в Story
и JSON. Теперь ими владеет один источник, а две границы собирают свои envelopes отдельно.
Совпадающие слова в критериях разных исторических версий остаются независимыми снимками;
дата, состояние и версия не вычисляются из текущей версии задания. Контроль сравнил все поля
прежних HTTP/Story payloads, фильтр без комментария и длинные страницы на 0, 1, 12 и 50 записей
с неизменёнными исходниками Git. Ожидаемые значения существующих UI tests не перенесены в
адаптер и не вычисляются production mapper.

Модульными тестами сдач владеет отдельный исполнитель audit2. Этот срез сохраняет их API,
но сам их миграцию не выполняет. People histories/overview, sales/reference и окончательная
таблица четырёх семейств остаются отдельной работой audit1. Общее ограничение CLI #2267
сохраняется отдельно. Прежняя живая проверка #2297 от 2026-11-17, опубликованная в
[PR2304](https://github.com/sachkov-inside/platform/pull/2304), охватывала 22 сценария
и не включала unavailable. Она не доказывает текущий срез #2313.
