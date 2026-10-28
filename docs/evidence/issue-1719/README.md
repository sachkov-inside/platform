# Админка: Обзор и итоговые снимки спецификации

Задача [#1719](https://github.com/sachkov-inside/platform/issues/1719) спецификации
[#1717](https://github.com/sachkov-inside/platform/issues/1717). Production visual gate по разделу
«Визуальная приёмка» для ключевых страниц всей спецификации на интегрированном коде: Обзор,
люди, карточка человека, вкладки страницы продукта, платежи, материалы и сдачи. Storybook и живой
маршрут на 390 и 1440 px, доступность, отсутствие горизонтальной прокрутки. Visual GO владелец
даёт по итоговому интегрированному результату. Названия, имена, email, суммы и даты вымышлены.

Итоговая съёмка 28 октября 2026 года на коде интеграционной ветки
`8852218987d941d05878b2d9f63f3516a13f9c95` (`feat/1717-admin-redesign`) вместе с исправлением
каскада стилей из раздела «Найдено при итоговой съёмке»: все снимки и файлы проверок ниже сделаны
заново на этом коде.

## Ключевые снимки для приёмки

Живой маршрут, production-сборка: шесть страниц (у страницы продукта две вкладки) на двух ширинах.

| Страница | Компьютер, 1440 px | Телефон, 390 px |
| --- | --- | --- |
| Обзор владельца | [Снимок](live-overview-desktop-chromium.png) | [Снимок](live-overview-mobile-chromium.png) |
| Люди | [Снимок](live-people-desktop-chromium.png) | [Снимок](live-people-mobile-chromium.png) |
| Карточка человека | [Снимок](live-person-card-desktop-chromium.png) | [Снимок](live-person-card-mobile-chromium.png) |
| Страница продукта, «Обзор» | [Снимок](live-product-overview-desktop-chromium.png) | [Снимок](live-product-overview-mobile-chromium.png) |
| Страница продукта, «Продажа» | [Снимок](live-product-sale-desktop-chromium.png) | [Снимок](live-product-sale-mobile-chromium.png) |
| Платежи | [Снимок](live-payments-desktop-chromium.png) | [Снимок](live-payments-mobile-chromium.png) |
| Материалы | [Снимок](live-materials-desktop-chromium.png) | [Снимок](live-materials-mobile-chromium.png) |

## Живой маршрут

Код: `8852218987d941d05878b2d9f63f3516a13f9c95`, 28 октября 2026 года.

Production-сборка web (`next build`) против тестового HTTP-бэкенда набора навигации
(`apps/web/test/navigation/fake-backend.mjs`), а не общего стенда. Chromium 1440 × 1024 и
мобильный Chromium 390 × 844. Снимки делает сценарий
`apps/web/test/navigation/admin-spec-evidence.spec.ts` через `adminEvidence` из
`apps/web/test/support/sales-admin-evidence.ts`:

```bash
CAPTURE_ADMIN_SPEC_EVIDENCE=1 UPDATE_EVIDENCE=issue-1719 pnpm --filter @inside/web test:navigation \
  test/navigation/admin-spec-evidence.spec.ts test/navigation/authoring-overview.spec.ts \
  test/navigation/content-collections.spec.ts
```

Без флага сценарий съёмки пропускается, остальные сценарии ничего не снимают. На каждом снимке до
съёмки проверены `scrollWidth === clientWidth` и Axe по всей странице вместе с каркасом:
нарушений 0 ([компьютер](live-checks-desktop-chromium.json), [телефон](live-checks-mobile-chromium.json)).
Снимки показывают всю страницу; на телефоне окно на время снимка растянуто на высоту документа,
поэтому нижняя панель стоит в конце снимка. Пустая полоса под панелью на снимках телефона
появляется только от этого растяжения окна при съёмке: в настоящем окне 390 × 844, прокрученном до
конца, панель стоит вплотную к нижнему краю, что сценарий проверяет по её положению и показывает
отдельный снимок окна без растяжения (последняя строка таблицы).

| Состояние | Компьютер, 1440 px | Телефон, 390 px |
| --- | --- | --- |
| Обзор владельца, 30 дней (`/authoring`) | [Снимок](live-overview-desktop-chromium.png) | [Снимок](live-overview-mobile-chromium.png) |
| Обзор: «Всё в порядке», 7 дней, график продаж (`/authoring?period=7&metric=sales`) | [Снимок](live-overview-all-clear-desktop-chromium.png) | [Снимок](live-overview-all-clear-mobile-chromium.png) |
| Обзор автора только материалов: закрытые правом блоки сведены в один отказ, периода нет | [Снимок](live-overview-materials-only-desktop-chromium.png) | [Снимок](live-overview-materials-only-mobile-chromium.png) |
| Люди (`/authoring/people`) | [Снимок](live-people-desktop-chromium.png) | [Снимок](live-people-mobile-chromium.png) |
| Карточка человека (`/authoring/people/<id>`) | [Снимок](live-person-card-desktop-chromium.png) | [Снимок](live-person-card-mobile-chromium.png) |
| Страница продукта, вкладка «Обзор» по умолчанию | [Снимок](live-product-overview-desktop-chromium.png) | [Снимок](live-product-overview-mobile-chromium.png) |
| Страница продукта, вкладка «Программа» (`?tab=program`) | [Снимок](live-product-program-desktop-chromium.png) | [Снимок](live-product-program-mobile-chromium.png) |
| Страница продукта, вкладка «Продажа» (`?tab=sale`) | [Снимок](live-product-sale-desktop-chromium.png) | [Снимок](live-product-sale-mobile-chromium.png) |
| Страница продукта, вкладка «Ученики» (`?tab=learners`) | [Снимок](live-product-learners-desktop-chromium.png) | [Снимок](live-product-learners-mobile-chromium.png) |
| Платежи (`/authoring/sales/payments`) | [Снимок](live-payments-desktop-chromium.png) | [Снимок](live-payments-mobile-chromium.png) |
| Платежи из «Требует внимания»: оплачены, выдача не завершена (`?state=confirmed&fulfillment=incomplete`) | [Снимок](live-payments-fulfillment-incomplete-desktop-chromium.png) | [Снимок](live-payments-fulfillment-incomplete-mobile-chromium.png) |
| Материалы (`/authoring/materials`) | [Снимок](live-materials-desktop-chromium.png) | [Снимок](live-materials-mobile-chromium.png) |
| Сдачи (`/authoring/submissions`, фильтр «Без комментария») | [Снимок](live-submissions-desktop-chromium.png) | [Снимок](live-submissions-mobile-chromium.png) |
| Обзор в окне 390 × 844 без растяжения, прокручен до конца: нижняя панель вплотную к краю окна | нет снимка для этой ширины | [Снимок](live-overview-bottom-viewport-mobile-chromium.png) |

## Storybook

Код: `8852218987d941d05878b2d9f63f3516a13f9c95`, 28 октября 2026 года.

Собранный Storybook (`pnpm --filter @inside/web build-storybook`), история после завершения её
`play`:

```bash
UPDATE_EVIDENCE=issue-1719 node apps/web/test/evidence/capture-admin-spec.mjs
```

Парные истории `…Desktop`/`…Mobile` задают свою ширину и сняты на ней; история без пары снята на
обеих. Для каждого снимка проверены `scrollWidth === clientWidth` и Axe внутри `#storybook-root` и
открытых им диалогов: нарушений 0, `play` без ошибок ([проверки](storybook-checks.json)). Правило
`region` выключено, как в addon a11y Storybook: история показывает часть страницы, а целые
страницы проверены на живом маршруте. Оранжевая рамка на части снимков (кнопка периода, вкладка,
меню строки, поле графика) показывает фокус, который оставил `play` истории. Storybook и маршрут
импортируют одни и те же модули.

| История | 1440 px | 390 px |
| --- | --- | --- |
| `Pages/Authoring/Обзор` › `Owner` / `OwnerMobile` | [Снимок](storybook-pages-authoring-overview--owner-1440.png) | [Снимок](storybook-pages-authoring-overview--owner-mobile-390.png) |
| `Pages/Authoring/Обзор` › `EmptyPeriod` / `EmptyPeriodMobile` | [Снимок](storybook-pages-authoring-overview--empty-period-1440.png) | [Снимок](storybook-pages-authoring-overview--empty-period-mobile-390.png) |
| `Pages/Authoring/Обзор` › `OneSale` / `OneSaleMobile` | [Снимок](storybook-pages-authoring-overview--one-sale-1440.png) | [Снимок](storybook-pages-authoring-overview--one-sale-mobile-390.png) |
| `Pages/Authoring/Обзор` › `LongLists` / `LongListsMobile` | [Снимок](storybook-pages-authoring-overview--long-lists-1440.png) | [Снимок](storybook-pages-authoring-overview--long-lists-mobile-390.png) |
| `Pages/Authoring/Обзор` › `MaterialsOnly` / `MaterialsOnlyMobile` | [Снимок](storybook-pages-authoring-overview--materials-only-1440.png) | [Снимок](storybook-pages-authoring-overview--materials-only-mobile-390.png) |
| `Pages/Authoring/Обзор` › `Unavailable` / `UnavailableMobile` | [Снимок](storybook-pages-authoring-overview--unavailable-1440.png) | [Снимок](storybook-pages-authoring-overview--unavailable-mobile-390.png) |
| `Pages/Authoring/Обзор` › `AllClear` / `AllClearMobile` | [Снимок](storybook-pages-authoring-overview--all-clear-1440.png) | [Снимок](storybook-pages-authoring-overview--all-clear-mobile-390.png) |
| `Pages/Authoring/Обзор продукта` › `Ready` / `ReadyMobile` | [Снимок](storybook-pages-authoring-product-overview--ready-1440.png) | [Снимок](storybook-pages-authoring-product-overview--ready-mobile-390.png) |
| `Pages/Authoring/Обзор продукта` › `Empty` / `EmptyMobile` | [Снимок](storybook-pages-authoring-product-overview--empty-1440.png) | [Снимок](storybook-pages-authoring-product-overview--empty-mobile-390.png) |
| `Pages/Authoring/Обзор продукта` › `Unavailable` / `UnavailableMobile` | [Снимок](storybook-pages-authoring-product-overview--unavailable-1440.png) | [Снимок](storybook-pages-authoring-product-overview--unavailable-mobile-390.png) |
| `Pages/Authoring/Обзор продукта` › `MaterialsOnly` / `MaterialsOnlyMobile` | [Снимок](storybook-pages-authoring-product-overview--materials-only-1440.png) | [Снимок](storybook-pages-authoring-product-overview--materials-only-mobile-390.png) |
| `Pages/Authoring/Редактор продукта` › `Desktop` / `Mobile` | [Снимок](storybook-pages-authoring-product-editor--desktop-1440.png) | [Снимок](storybook-pages-authoring-product-editor--mobile-390.png) |
| `Pages/Authoring/Редактор продукта` › `SaleTabDesktop` / `SaleTabMobile` | [Снимок](storybook-pages-authoring-product-editor--sale-tab-desktop-1440.png) | [Снимок](storybook-pages-authoring-product-editor--sale-tab-mobile-390.png) |
| `Pages/Authoring/Редактор продукта` › `LearnersTabDesktop` / `LearnersTabMobile` | [Снимок](storybook-pages-authoring-product-editor--learners-tab-desktop-1440.png) | [Снимок](storybook-pages-authoring-product-editor--learners-tab-mobile-390.png) |
| `Pages/Authoring/Люди` › `Populated` / `Mobile` | [Снимок](storybook-pages-authoring-people--populated-1440.png) | [Снимок](storybook-pages-authoring-people--mobile-390.png) |
| `Pages/Authoring/Карточка человека` › `AllBlocks` / `AllBlocksMobile` | [Снимок](storybook-pages-authoring-person--all-blocks-1440.png) | [Снимок](storybook-pages-authoring-person--all-blocks-mobile-390.png) |
| `Pages/Authoring/Платежи` › `OneSale` / `OneSaleMobile` | [Снимок](storybook-pages-authoring-payments--one-sale-1440.png) | [Снимок](storybook-pages-authoring-payments--one-sale-mobile-390.png) |
| `Pages/Authoring/Материалы` › `Populated` / `Mobile` | [Снимок](storybook-pages-authoring-materials--populated-1440.png) | [Снимок](storybook-pages-authoring-materials--mobile-390.png) |
| `Pages/Authoring/Task submissions` › `Submissions` / `SubmissionsMobile` | [Снимок](storybook-pages-authoring-task-submissions--submissions-1440.png) | [Снимок](storybook-pages-authoring-task-submissions--submissions-mobile-390.png) |
| `Components/Админка/MetricCard` › `OverviewRowDesktop` / `OverviewRowMobile` | [Снимок](storybook-components-admin-metric-card--overview-row-desktop-1440.png) | [Снимок](storybook-components-admin-metric-card--overview-row-mobile-390.png) |
| `Components/Админка/MetricCard` › `WithDetailDesktop` / `UnavailableMobile` | [Снимок](storybook-components-admin-metric-card--with-detail-desktop-1440.png) | [Снимок](storybook-components-admin-metric-card--unavailable-mobile-390.png) |
| `Components/Админка/TrendChart` › `ThirtyDaysDesktop` / `ThirtyDaysMobile` | [Снимок](storybook-components-admin-trend-chart--thirty-days-desktop-1440.png) | [Снимок](storybook-components-admin-trend-chart--thirty-days-mobile-390.png) |
| `Components/Админка/TrendChart` › `NegativeDayDesktop` / `NegativeDayMobile` | [Снимок](storybook-components-admin-trend-chart--negative-day-desktop-1440.png) | [Снимок](storybook-components-admin-trend-chart--negative-day-mobile-390.png) |
| `Components/Админка/TrendChart` › `EmptyDesktop` / `EmptyMobile` | [Снимок](storybook-components-admin-trend-chart--empty-desktop-1440.png) | [Снимок](storybook-components-admin-trend-chart--empty-mobile-390.png) |

## Найдено при съёмке

Исправлено до финальной съёмки, отдельными коммитами `fix(web)`:

- Обзор автора только материалов показывал переключатель периода и три отдельных отказа (продажи,
  воронка, обучение). Теперь это один отказ «Продажи и доступы», а период не показывается: от
  него на странице ничего не зависит.
- Вкладка «Обзор» продукта: на телефоне четыре карточки шли как 1 + 2 + 1, «Обучение» занимало две
  трети ширины, а значение «Набор не открыт» переносилось крупным шрифтом. Теперь карточки идут два
  на два, «Обучение» во всю ширину, значение «Нет набора», а причина в подстроке.
- «Сдачи» стояли с собственными полями (76rem, 52px) и не совпадали с заголовками остальных
  разделов. Теперь у них общее тело страницы админки (1280px, 36/40/64 и 24/16/48).
- Недоступный показатель «Недоступно» в узкой карточке рвался посреди слова. Теперь он мельче,
  приглушён и не переносится.
- Тестовый бэкенд набора навигации: вкладка «Программа» показывала сбой чтения артефактов (не было
  ответа на списки артефактов автора), а платёж с незавершённой выдачей стоял с плашкой «Доступ
  открыт». Теперь список артефактов пуст, а у такого платежа плашка «Доступ готовится».

## Найдено при итоговой съёмке

Исправлено в этом же PR, после чего все снимки сняты заново:

- Вкладка «Продажа» страницы продукта: на `8852218` поля «Цена», «Дата старта» и «Цена после
  старта» растягивались во всю колонку (на 1440 px поле цены около 1030 px, знак «₽» у правого
  края), а кольцо фокуса кнопки меню строки в «Людях» и «Материалах» отходило дальше от кнопки.
  Причина в каскаде: общие правила каркаса `.authoring-workspace` для полей (`max-width`),
  переносов, таблиц и кольца фокуса совпадали по специфичности с правилами модулей
  (`.admin-field-input`, `.admin-focus-ring:focus-visible` и другими), и исход решал порядок
  таблиц стилей в сборке, который на `8852218` поменялся. Теперь область каркаса во всех четырёх
  правилах взята в `:where()` (`apps/web/src/widgets/authoring-shell/ui/authoring-shell.css`), и
  правило модуля побеждает при любом порядке.
- Поля админки (`.admin-field-input`, `.admin-field-textarea`, `.admin-search input`) больше не
  задают `outline: none` (`apps/web/src/shared/ui/admin/admin.css`): иначе они сравнивались бы с
  кольцом фокуса каркаса по порядку стилей. Фокус поля выглядит как раньше: кольцо каркаса и
  собственные рамка и тень поля.
- Ширину полей суммы и даты на вкладке «Продажа» на 390 и 1440 px проверяет сценарий
  `apps/web/test/navigation/content-collections.spec.ts`. После исправления все 75 снимков
  совпадают со снимками `49ec1062d` с точностью до сглаживания.
