# Админка: Обзор и итоговые снимки спецификации

Задача [#1719](https://github.com/sachkov-inside/platform/issues/1719) спецификации
[#1717](https://github.com/sachkov-inside/platform/issues/1717). Production visual gate по разделу
«Визуальная приёмка» для ключевых страниц всей спецификации на интегрированном коде: Обзор,
люди, карточка человека, вкладки страницы продукта, платежи, материалы и сдачи. Storybook и живой
маршрут на 390 и 1440 px, доступность, отсутствие горизонтальной прокрутки. Visual GO владелец
даёт по итоговому интегрированному результату. Названия, имена, email, суммы и даты вымышлены.

## Живой маршрут

Код: `49ec1062d1ce92c850d536bee20166977183c04b`.

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
поэтому нижняя панель стоит в конце снимка, а под ней остаётся пустая полоса окна.

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

## Storybook

Код: `49ec1062d1ce92c850d536bee20166977183c04b`.

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
