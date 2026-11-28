# Админка: страница продукта и продажи

Задача [#1718](https://github.com/sachkov-inside/platform/issues/1718) спецификации
[#1717](https://github.com/sachkov-inside/platform/issues/1717). Production visual gate по разделу
«Визуальная приёмка»: UI catalog и живой маршрут на 390 и 1440 px, доступность, отсутствие
горизонтальной прокрутки. Visual GO владелец даёт по итоговому интегрированному результату.

Первая съёмка шла на коде `89eb9436f45f27dbf5cc5511a61efae308f0d37c`. После слияния #1721 («Люди»,
`6d8a17878`) и исправлений визуальных заметок наборы сняты заново: у каждого набора ниже указан его
код. Снимок, который не изменился побайтно, остался прежним файлом. После review на ветке могут
появиться новые коммиты; снимки относятся к указанному коду. Названия, имена, email и даты
вымышлены.

## Живой маршрут

Код: `2b8e80e267065fe5d3eeb4842bf3fd0a1fedec87` (весь набор навигации с одной сборкой, затем
`content-collections`, `product-learners` и `authoring-people` повторно на той же сборке).

Production-сборка web (`next build`) против тестового HTTP-бэкенда набора навигации
(`apps/web/test/navigation/fake-backend.mjs`), а не общего стенда. Chromium 1440 × 1024 и
мобильный Chromium 390 × 844. Снимки делают сами навигационные сценарии #1718
(`sales-payments`, `sales-catalog`, `product-learners`, `content-collections`) через
`apps/web/test/support/sales-admin-evidence.ts`:

```bash
CAPTURE_SALES_ADMIN_EVIDENCE=1 UPDATE_EVIDENCE=issue-1718 pnpm --filter @inside/web test:navigation \
  test/navigation/sales-payments.spec.ts test/navigation/sales-catalog.spec.ts \
  test/navigation/product-learners.spec.ts test/navigation/content-collections.spec.ts
```

Без флага сценарии идут как обычно и ничего не снимают. На каждом снимке до съёмки проверены
`scrollWidth === clientWidth` и Axe по всей странице вместе с каркасом: нарушений 0
([компьютер](live-checks-desktop-chromium.json), [телефон](live-checks-mobile-chromium.json)).
Снимки показывают всю страницу; на телефоне окно на время снимка растянуто на высоту документа,
поэтому нижняя панель стоит в конце снимка.

| Состояние | Компьютер, 1440 px | Телефон, 390 px |
| --- | --- | --- |
| Продукты: колонки «Продажа» (плашка в одну строку) и «Обладатели» (число из тестового бэкенда навигации) | [Снимок](live-products-desktop-chromium.png) | [Снимок](live-products-mobile-chromium.png) |
| Продукт, вкладка «Продажа»: цена, состояние продажи, блок ссылок на оплату (`?tab=sale`) | [Снимок](live-product-sale-desktop-chromium.png) | [Снимок](live-product-sale-mobile-chromium.png) |
| Продукт, вкладка «Продажа» с ценой в архиве | [Снимок](live-product-sale-archived-price-desktop-chromium.png) | [Снимок](live-product-sale-archived-price-mobile-chromium.png) |
| Продукт, вкладка «Ученики»: подписи людей вместо ID (`?tab=learners`) | [Снимок](live-product-learners-desktop-chromium.png) | [Снимок](live-product-learners-mobile-chromium.png) |
| Диалог «Выдать продукт»: выбраны три человека, один уже с доступом | [Снимок](live-grant-product-desktop-chromium.png) | [Снимок](live-grant-product-mobile-chromium.png) |
| Диалог «Выдать продукт»: итог выдачи с ошибкой и повтором | [Снимок](live-grant-product-outcome-desktop-chromium.png) | [Снимок](live-grant-product-outcome-mobile-chromium.png) |
| Продукт, вкладка «Сообщество и активация» (`?tab=community`) | [Снимок](live-product-community-desktop-chromium.png) | [Снимок](live-product-community-mobile-chromium.png) |
| Платежи | [Снимок](live-payments-desktop-chromium.png) | [Снимок](live-payments-mobile-chromium.png) |
| Платежи с фильтрами состояния, продукта и даты | [Снимок](live-payments-filtered-desktop-chromium.png) | [Снимок](live-payments-filtered-mobile-chromium.png) |
| Платёж с показанным email заказа после «Показать email» | [Снимок](live-payment-desktop-chromium.png) | [Снимок](live-payment-mobile-chromium.png) |
| Ссылки на оплату | [Снимок](live-payment-links-desktop-chromium.png) | [Снимок](live-payment-links-mobile-chromium.png) |
| Новая ссылка на оплату: лист на телефоне (скидка 15 %), диалог на компьютере (сумма) | [Снимок](live-payment-link-create-desktop-chromium.png) | [Снимок](live-payment-link-create-mobile-chromium.png) |
| Ссылка создана | [Снимок](live-payment-link-created-desktop-chromium.png) | [Снимок](live-payment-link-created-mobile-chromium.png) |
| Скидки | [Снимок](live-discounts-desktop-chromium.png) | [Снимок](live-discounts-mobile-chromium.png) |
| Форма новой скидки | [Снимок](live-discount-form-desktop-chromium.png) | [Снимок](live-discount-form-mobile-chromium.png) |
| Скидки, архив (`?archived=1`) | [Снимок](live-discounts-archive-desktop-chromium.png) | [Снимок](live-discounts-archive-mobile-chromium.png) |
| Анкетные скидки, архив только для чтения (`?view=questionnaire`) | [Снимок](live-discounts-questionnaire-desktop-chromium.png) | [Снимок](live-discounts-questionnaire-mobile-chromium.png) |
| Воронка продаж | [Снимок](live-funnel-desktop-chromium.png) | [Снимок](live-funnel-mobile-chromium.png) |

## UI catalog

Код: `eddd5309fa73e6c0b4ee6703822df3a6dc61b136` (после него менялись только навигационные проверки).

Собранный UI catalog (`pnpm build:ui-catalog`), история после завершения её `play`:

```bash
UPDATE_EVIDENCE=issue-1718 node apps/web/test/evidence/capture-sales-admin.mjs
```

Парные истории `…Desktop`/`…Mobile` задают свою ширину и сняты на ней; история без пары снята на
обеих. Для каждого снимка проверены `scrollWidth === clientWidth` и Axe внутри `#ui-catalog-root` и
открытых им диалогов: нарушений 0, `play` без ошибок ([проверки](ui-catalog-checks.json)). Правило
`region` выключено, как в addon a11y ui-catalog: история показывает часть страницы, а целые
страницы проверены на живом маршруте. UI catalog и маршрут импортируют одни и те же модули.

| История | 1440 px | 390 px |
| --- | --- | --- |
| `Pages/Authoring/Редактор продукта` › `SaleTabDesktop` / `SaleTabMobile` | [Снимок](ui-catalog-pages-authoring-product-editor--sale-tab-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-product-editor--sale-tab-mobile-390.png) |
| `Pages/Authoring/Редактор продукта` › `LearnersTabDesktop` / `LearnersTabMobile` | [Снимок](ui-catalog-pages-authoring-product-editor--learners-tab-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-product-editor--learners-tab-mobile-390.png) |
| `Pages/Authoring/Редактор продукта` › `CommunityTabDesktop` / `CommunityTabMobile` | [Снимок](ui-catalog-pages-authoring-product-editor--community-tab-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-product-editor--community-tab-mobile-390.png) |
| `Features/Product/Продажа продукта` › `UnpricedDesktop` / `UnpricedMobile` | [Снимок](ui-catalog-features-product-sale--unpriced-desktop-1440.png) | [Снимок](ui-catalog-features-product-sale--unpriced-mobile-390.png) |
| `Features/Product/Продажа продукта` › `ClosedDesktop` / `ClosedMobile` | [Снимок](ui-catalog-features-product-sale--closed-desktop-1440.png) | [Снимок](ui-catalog-features-product-sale--closed-mobile-390.png) |
| `Features/Product/Продажа продукта` › `RunningDesktop` / `RunningMobile` | [Снимок](ui-catalog-features-product-sale--running-desktop-1440.png) | [Снимок](ui-catalog-features-product-sale--running-mobile-390.png) |
| `Features/Product/Продажа продукта` › `PriceArchivedDesktop` / `PriceArchivedMobile` | [Снимок](ui-catalog-features-product-sale--price-archived-desktop-1440.png) | [Снимок](ui-catalog-features-product-sale--price-archived-mobile-390.png) |
| `Features/Product/Продажа продукта` › `UnavailableDesktop` / `UnavailableMobile` | [Снимок](ui-catalog-features-product-sale--unavailable-desktop-1440.png) | [Снимок](ui-catalog-features-product-sale--unavailable-mobile-390.png) |
| `Features/Product/Продажа продукта` › `ForbiddenDesktop` / `ForbiddenMobile` | [Снимок](ui-catalog-features-product-sale--forbidden-desktop-1440.png) | [Снимок](ui-catalog-features-product-sale--forbidden-mobile-390.png) |
| `Features/Product/Сообщество и активация` › `RulesDesktop` / `RulesMobile` | [Снимок](ui-catalog-features-product-community--rules-desktop-1440.png) | [Снимок](ui-catalog-features-product-community--rules-mobile-390.png) |
| `Features/Product/Сообщество и активация` › `EmptyDesktop` / `EmptyMobile` | [Снимок](ui-catalog-features-product-community--empty-desktop-1440.png) | [Снимок](ui-catalog-features-product-community--empty-mobile-390.png) |
| `Features/Product/Сообщество и активация` › `UnavailableDesktop` / `UnavailableMobile` | [Снимок](ui-catalog-features-product-community--unavailable-desktop-1440.png) | [Снимок](ui-catalog-features-product-community--unavailable-mobile-390.png) |
| `Pages/Authoring/Продукт/Ученики` › `OneLearnerDesktop` / `OneLearnerMobile` | [Снимок](ui-catalog-pages-authoring-product-learners--one-learner-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-product-learners--one-learner-mobile-390.png) |
| `Pages/Authoring/Продукт/Ученики` › `LongListDesktop` / `LongListMobile` | [Снимок](ui-catalog-pages-authoring-product-learners--long-list-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-product-learners--long-list-mobile-390.png) |
| `Pages/Authoring/Продукт/Ученики` › `EmptyDesktop` / `EmptyMobile` | [Снимок](ui-catalog-pages-authoring-product-learners--empty-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-product-learners--empty-mobile-390.png) |
| `Pages/Authoring/Продукт/Ученики` › `RefusedDesktop` / `RefusedMobile` | [Снимок](ui-catalog-pages-authoring-product-learners--refused-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-product-learners--refused-mobile-390.png) |
| `Pages/Authoring/Продукт/Ученики` › `ErrorDesktop` / `ErrorMobile` | [Снимок](ui-catalog-pages-authoring-product-learners--error-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-product-learners--error-mobile-390.png) |
| `Pages/Authoring/Продукт/Выдать продукт` › `SelectionDesktop` / `SelectionMobile` | [Снимок](ui-catalog-pages-authoring-product-grant--selection-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-product-grant--selection-mobile-390.png) |
| `Pages/Authoring/Продукт/Выдать продукт` › `PartialFailureDesktop` / `PartialFailureMobile` | [Снимок](ui-catalog-pages-authoring-product-grant--partial-failure-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-product-grant--partial-failure-mobile-390.png) |
| `Pages/Authoring/Продукты` › `ProductsDesktop` / `ProductsMobile` | [Снимок](ui-catalog-pages-authoring-products--products-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-products--products-mobile-390.png) |
| `Pages/Authoring/Продукты` › `LongList` / `LongListMobile` | [Снимок](ui-catalog-pages-authoring-products--long-list-1440.png) | [Снимок](ui-catalog-pages-authoring-products--long-list-mobile-390.png) |
| `Pages/Authoring/Продукты` › `Empty` / `EmptyMobile` | [Снимок](ui-catalog-pages-authoring-products--empty-1440.png) | [Снимок](ui-catalog-pages-authoring-products--empty-mobile-390.png) |
| `Pages/Authoring/Продукты` › `SaleWithoutOwnerPrices` / `SaleWithoutOwnerPricesMobile` | [Снимок](ui-catalog-pages-authoring-products--sale-without-owner-prices-1440.png) | [Снимок](ui-catalog-pages-authoring-products--sale-without-owner-prices-mobile-390.png) |
| `Pages/Authoring/Платежи` › `OneSale` / `OneSaleMobile` | [Снимок](ui-catalog-pages-authoring-payments--one-sale-1440.png) | [Снимок](ui-catalog-pages-authoring-payments--one-sale-mobile-390.png) |
| `Pages/Authoring/Платежи` › `LongList` / `LongListMobile` | [Снимок](ui-catalog-pages-authoring-payments--long-list-1440.png) | [Снимок](ui-catalog-pages-authoring-payments--long-list-mobile-390.png) |
| `Pages/Authoring/Платежи` › `Empty` / `EmptyMobile` | [Снимок](ui-catalog-pages-authoring-payments--empty-1440.png) | [Снимок](ui-catalog-pages-authoring-payments--empty-mobile-390.png) |
| `Pages/Authoring/Платежи` › `FilteredNoResults` / `FilteredNoResultsMobile` | [Снимок](ui-catalog-pages-authoring-payments--filtered-no-results-1440.png) | [Снимок](ui-catalog-pages-authoring-payments--filtered-no-results-mobile-390.png) |
| `Pages/Authoring/Платежи` › `Unavailable` / `UnavailableMobile` | [Снимок](ui-catalog-pages-authoring-payments--unavailable-1440.png) | [Снимок](ui-catalog-pages-authoring-payments--unavailable-mobile-390.png) |
| `Pages/Authoring/Платежи` › `Forbidden` | [Снимок](ui-catalog-pages-authoring-payments--forbidden-1440.png) | [Снимок](ui-catalog-pages-authoring-payments--forbidden-390.png) |
| `Pages/Authoring/Платёж` › `WithRefunds` / `WithRefundsMobile` | [Снимок](ui-catalog-pages-authoring-payment--with-refunds-1440.png) | [Снимок](ui-catalog-pages-authoring-payment--with-refunds-mobile-390.png) |
| `Pages/Authoring/Платёж` › `UnknownState` / `UnknownStateMobile` | [Снимок](ui-catalog-pages-authoring-payment--unknown-state-1440.png) | [Снимок](ui-catalog-pages-authoring-payment--unknown-state-mobile-390.png) |
| `Pages/Authoring/Платёж` › `NotFound` | [Снимок](ui-catalog-pages-authoring-payment--not-found-1440.png) | [Снимок](ui-catalog-pages-authoring-payment--not-found-390.png) |
| `Pages/Authoring/Платёж` › `Unavailable` | нет истории для этой ширины | [Снимок](ui-catalog-pages-authoring-payment--unavailable-390.png) |
| `Pages/Authoring/Платёж/Email заказа` › `Hidden` / `HiddenMobile` | [Снимок](ui-catalog-pages-authoring-payment-order-email--hidden-1440.png) | [Снимок](ui-catalog-pages-authoring-payment-order-email--hidden-mobile-390.png) |
| `Pages/Authoring/Платёж/Email заказа` › `Shown` / `ShownMobile` | [Снимок](ui-catalog-pages-authoring-payment-order-email--shown-1440.png) | [Снимок](ui-catalog-pages-authoring-payment-order-email--shown-mobile-390.png) |
| `Pages/Authoring/Платёж/Email заказа` › `Forbidden` | [Снимок](ui-catalog-pages-authoring-payment-order-email--forbidden-1440.png) | [Снимок](ui-catalog-pages-authoring-payment-order-email--forbidden-390.png) |
| `Pages/Authoring/Sales/Payment links` › `EmptyDesktop` / `EmptyMobile` | [Снимок](ui-catalog-pages-authoring-sales-payment-links--empty-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-payment-links--empty-mobile-390.png) |
| `Pages/Authoring/Sales/Payment links` › `OneLinkDesktop` / `OneLinkMobile` | [Снимок](ui-catalog-pages-authoring-sales-payment-links--one-link-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-payment-links--one-link-mobile-390.png) |
| `Pages/Authoring/Sales/Payment links` › `LongListDesktop` / `LongListMobile` | [Снимок](ui-catalog-pages-authoring-sales-payment-links--long-list-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-payment-links--long-list-mobile-390.png) |
| `Pages/Authoring/Sales/Payment links` › `LinkDetailsDesktop` / `LinkDetailsMobile` | [Снимок](ui-catalog-pages-authoring-sales-payment-links--link-details-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-payment-links--link-details-mobile-390.png) |
| `Pages/Authoring/Sales/Payment links` › `RefusedDesktop` / `RefusedMobile` | [Снимок](ui-catalog-pages-authoring-sales-payment-links--refused-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-payment-links--refused-mobile-390.png) |
| `Pages/Authoring/Sales/Payment links` › `Unavailable` | [Снимок](ui-catalog-pages-authoring-sales-payment-links--unavailable-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-payment-links--unavailable-390.png) |
| `Components/Админка/Продажи/Создание ссылки на оплату` › `ProductPriceDesktop` / `ProductPriceMobile` | [Снимок](ui-catalog-components-admin-sales-payment-link-create--product-price-desktop-1440.png) | [Снимок](ui-catalog-components-admin-sales-payment-link-create--product-price-mobile-390.png) |
| `Components/Админка/Продажи/Создание ссылки на оплату` › `DiscountDesktop` / `DiscountMobile` | [Снимок](ui-catalog-components-admin-sales-payment-link-create--discount-desktop-1440.png) | [Снимок](ui-catalog-components-admin-sales-payment-link-create--discount-mobile-390.png) |
| `Components/Админка/Продажи/Создание ссылки на оплату` › `CreatedDesktop` / `CreatedMobile` | [Снимок](ui-catalog-components-admin-sales-payment-link-create--created-desktop-1440.png) | [Снимок](ui-catalog-components-admin-sales-payment-link-create--created-mobile-390.png) |
| `Components/Админка/Продажи/Создание ссылки на оплату` › `ProductsUnavailable` | [Снимок](ui-catalog-components-admin-sales-payment-link-create--products-unavailable-1440.png) | [Снимок](ui-catalog-components-admin-sales-payment-link-create--products-unavailable-390.png) |
| `Pages/Authoring/Sales/Discounts` › `EmptyDesktop` / `EmptyMobile` | [Снимок](ui-catalog-pages-authoring-sales-discounts--empty-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-discounts--empty-mobile-390.png) |
| `Pages/Authoring/Sales/Discounts` › `ListDesktop` / `ListMobile` | [Снимок](ui-catalog-pages-authoring-sales-discounts--list-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-discounts--list-mobile-390.png) |
| `Pages/Authoring/Sales/Discounts` › `ArchiveDesktop` / `ArchiveMobile` | [Снимок](ui-catalog-pages-authoring-sales-discounts--archive-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-discounts--archive-mobile-390.png) |
| `Pages/Authoring/Sales/Discounts` › `QuestionnaireDesktop` / `QuestionnaireMobile` | [Снимок](ui-catalog-pages-authoring-sales-discounts--questionnaire-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-discounts--questionnaire-mobile-390.png) |
| `Pages/Authoring/Sales/Discounts` › `RefusedDesktop` / `RefusedMobile` | [Снимок](ui-catalog-pages-authoring-sales-discounts--refused-desktop-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-discounts--refused-mobile-390.png) |
| `Pages/Authoring/Sales/Discounts` › `Unavailable` | [Снимок](ui-catalog-pages-authoring-sales-discounts--unavailable-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-discounts--unavailable-390.png) |
| `Components/Админка/Продажи/Форма скидки` › `CreateDesktop` / `CreateMobile` | [Снимок](ui-catalog-components-admin-sales-promotion-form--create-desktop-1440.png) | [Снимок](ui-catalog-components-admin-sales-promotion-form--create-mobile-390.png) |
| `Components/Админка/Продажи/Форма скидки` › `EditDesktop` / `EditMobile` | [Снимок](ui-catalog-components-admin-sales-promotion-form--edit-desktop-1440.png) | [Снимок](ui-catalog-components-admin-sales-promotion-form--edit-mobile-390.png) |
| `Components/Админка/Продажи/Форма скидки` › `RevisionConflict` | [Снимок](ui-catalog-components-admin-sales-promotion-form--revision-conflict-1440.png) | [Снимок](ui-catalog-components-admin-sales-promotion-form--revision-conflict-390.png) |
| `Pages/Authoring/Sales funnel report` › `Ready` / `ReadyMobile` | [Снимок](ui-catalog-pages-authoring-sales-funnel--ready-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-funnel--ready-mobile-390.png) |
| `Pages/Authoring/Sales funnel report` › `EmptyPeriod` | [Снимок](ui-catalog-pages-authoring-sales-funnel--empty-period-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-funnel--empty-period-390.png) |
| `Pages/Authoring/Sales funnel report` › `Forbidden` | [Снимок](ui-catalog-pages-authoring-sales-funnel--forbidden-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-funnel--forbidden-390.png) |
| `Pages/Authoring/Sales funnel report` › `Unavailable` | [Снимок](ui-catalog-pages-authoring-sales-funnel--unavailable-1440.png) | [Снимок](ui-catalog-pages-authoring-sales-funnel--unavailable-390.png) |
| `Components/Админка/AdminConfirmDialog` › `DangerDesktop` / `DangerMobile` | [Снимок](ui-catalog-components-admin-confirm-dialog--danger-desktop-1440.png) | [Снимок](ui-catalog-components-admin-confirm-dialog--danger-mobile-390.png) |
| `Components/Админка/AdminConfirmDialog` › `WithError` | [Снимок](ui-catalog-components-admin-confirm-dialog--with-error-1440.png) | [Снимок](ui-catalog-components-admin-confirm-dialog--with-error-390.png) |
| `Components/Админка/Выбор из длинного списка` › `BoundedDesktop` / `BoundedMobile` | [Снимок](ui-catalog-components-admin-search-select--bounded-desktop-1440.png) | [Снимок](ui-catalog-components-admin-search-select--bounded-mobile-390.png) |

## Найдено при съёмке

- Поля, которым модуль задал `max-w-none`, оставались шириной 14rem: `admin.css` стоит вне слоёв
  Tailwind, и его предел сильнее утилиты. Адрес созданной ссылки на оплату обрезался, поиск в
  выборе из длинного списка, поиск людей в «Выдать продукт» и поле формы скидки были узкими.
  Исправлено модификатором `.admin-field-input-wide` в `apps/web/src/shared/ui/admin/admin.css`.
- Истории `Pages/Authoring/Продукт/Ученики` стояли без рамки страницы продукта, и на 1440 px конец
  длинного списка был обрезан. Истории получили ту же рамку `main#authoring-content`, что и
  маршрут.

- После первой съёмки: плашка «Продажи закрыты» в списке продуктов переносилась на две строки, а
  поле процента в новой ссылке на оплату было шириной 14rem вместо 8rem (утилита `max-w-[8rem]`
  не перебивала `admin.css`). Колонка «Продажа» стала шире за счёт числовых колонок, плашка стоит
  в одну строку; поле процента получило модификатор `.admin-field-input-narrow`.
- Тестовый бэкенд навигации не отдавал число обладателей, и живой список показывал «Нет данных».
  Теперь он отдаёт `holderCount` продуктов, как backend.

Горизонтальной прокрутки и нарушений Axe в production-модулях не найдено.
