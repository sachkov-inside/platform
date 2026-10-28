# Админка: каркас, общие модули, контент и сдачи

Задача [#1720](https://github.com/sachkov-inside/platform/issues/1720) спецификации
[#1717](https://github.com/sachkov-inside/platform/issues/1717), pull request
[#1725](https://github.com/sachkov-inside/platform/pull/1725). Production visual gate по разделу
«Визуальная приёмка»: Storybook и живой маршрут на 390 и 1440 px, доступность, отсутствие
горизонтальной прокрутки. Visual GO владелец даёт по итоговому интегрированному результату.

Снимки сделаны на коде `d145c920d8f6873f3caa10ea130c9df33ec69f2c`. Названия, имена и даты
вымышлены.

## Живой маршрут

Production-сборка web (`next build`) против тестового HTTP-бэкенда набора навигации
(`apps/web/test/navigation/fake-backend.mjs`), а не общего стенда. Chromium 1440 × 1024 и
мобильный Chromium 390 × 844. На каждом снимке до съёмки проверены
`scrollWidth === clientWidth` и Axe по всей странице вместе с каркасом: нарушений 0
([desktop](live-checks-desktop-chromium.json), [телефон](live-checks-mobile-chromium.json)).
Снимки компьютера показывают всю страницу, снимки телефона один экран с нижней панелью.

| Состояние | Компьютер, 1440 px | Телефон, 390 px |
| --- | --- | --- |
| Продукты | [Снимок](live-products-desktop-chromium.png) | [Снимок](live-products-mobile-chromium.png) |
| Продукт, вкладка «Описание и обложка» (`?tab=description`) | [Снимок](live-product-description-tab-desktop-chromium.png) | [Снимок](live-product-description-tab-mobile-chromium.png) |
| Темы | [Снимок](live-topics-desktop-chromium.png) | [Снимок](live-topics-mobile-chromium.png) |
| Материалы | [Снимок](live-materials-desktop-chromium.png) | [Снимок](live-materials-mobile-chromium.png) |
| Материалы с фильтрами темы и формата | [Снимок](live-materials-filtered-desktop-chromium.png) | [Снимок](live-materials-filtered-mobile-chromium.png) |
| Сдачи, фильтр «без комментария» по умолчанию | [Снимок](live-submissions-desktop-chromium.png) | [Снимок](live-submissions-mobile-chromium.png) |
| Сдача с формой комментария | [Снимок](live-submission-detail-desktop-chromium.png) | [Снимок](live-submission-detail-mobile-chromium.png) |
| Лист «Ещё» | только на телефоне | [Снимок](live-more-sheet-mobile-chromium.png) |
| Общий поиск | [Снимок](live-search-desktop-chromium.png) | [Снимок](live-search-mobile-chromium.png) |

## Storybook

Собранный Storybook (`pnpm build-storybook`), история после завершения её `play`. Для каждой
ширины проверены `scrollWidth === clientWidth` и Axe внутри `#storybook-root`: нарушений 0
([проверки](storybook-checks.json)). Storybook и маршрут импортируют одни и те же модули.

| История | 1440 px | 390 px |
| --- | --- | --- |
| `patterns-каркас-админки--desktop` | [Снимок](storybook-patterns-admin-shell--desktop-1440.png) | [Снимок](storybook-patterns-admin-shell--desktop-390.png) |
| `patterns-каркас-админки--mobile` | [Снимок](storybook-patterns-admin-shell--mobile-1440.png) | [Снимок](storybook-patterns-admin-shell--mobile-390.png) |
| `pages-authoring-материалы--populated` | [Снимок](storybook-pages-authoring-materials--populated-1440.png) | [Снимок](storybook-pages-authoring-materials--populated-390.png) |
| `pages-authoring-материалы--empty` | [Снимок](storybook-pages-authoring-materials--empty-1440.png) | [Снимок](storybook-pages-authoring-materials--empty-390.png) |
| `pages-authoring-материалы--no-results` | [Снимок](storybook-pages-authoring-materials--no-results-1440.png) | [Снимок](storybook-pages-authoring-materials--no-results-390.png) |
| `pages-authoring-продукты--products-desktop` | [Снимок](storybook-pages-authoring-products--products-desktop-1440.png) | [Снимок](storybook-pages-authoring-products--products-desktop-390.png) |
| `pages-authoring-продукты--empty` | [Снимок](storybook-pages-authoring-products--empty-1440.png) | [Снимок](storybook-pages-authoring-products--empty-390.png) |
| `pages-authoring-темы--topics-desktop` | [Снимок](storybook-pages-authoring-topics--topics-desktop-1440.png) | [Снимок](storybook-pages-authoring-topics--topics-desktop-390.png) |
| `pages-authoring-темы--topic-from-address` | [Снимок](storybook-pages-authoring-topics--topic-from-address-1440.png) | [Снимок](storybook-pages-authoring-topics--topic-from-address-390.png) |
| `pages-authoring-редактор-продукта--tab-from-address` | [Снимок](storybook-pages-authoring-product-editor--tab-from-address-1440.png) | [Снимок](storybook-pages-authoring-product-editor--tab-from-address-390.png) |
| `pages-authoring-task-submissions--submissions` | [Снимок](storybook-pages-authoring-task-submissions--submissions-1440.png) | [Снимок](storybook-pages-authoring-task-submissions--submissions-390.png) |
| `pages-authoring-task-submissions--submission` | [Снимок](storybook-pages-authoring-task-submissions--submission-1440.png) | [Снимок](storybook-pages-authoring-task-submissions--submission-390.png) |
| `pages-authoring-task-submissions--nothing-awaiting` | [Снимок](storybook-pages-authoring-task-submissions--nothing-awaiting-1440.png) | [Снимок](storybook-pages-authoring-task-submissions--nothing-awaiting-390.png) |
| `components-админка-admintable--materials-desktop` | [Снимок](storybook-components-admin-admintable--materials-desktop-1440.png) | [Снимок](storybook-components-admin-admintable--materials-desktop-390.png) |
| `components-админка-trendchart--thirty-days-desktop` | [Снимок](storybook-components-admin-trendchart--thirty-days-desktop-1440.png) | [Снимок](storybook-components-admin-trendchart--thirty-days-desktop-390.png) |
| `components-админка-metriccard--overview-row-desktop` | [Снимок](storybook-components-admin-metriccard--overview-row-desktop-1440.png) | [Снимок](storybook-components-admin-metriccard--overview-row-desktop-390.png) |
| `components-админка-reasondialog--revoke-desktop` | [Снимок](storybook-components-admin-reasondialog--revoke-desktop-1440.png) | [Снимок](storybook-components-admin-reasondialog--revoke-desktop-390.png) |
| `components-админка-adminfilterbar--materials-desktop` | [Снимок](storybook-components-admin-adminfilterbar--materials-desktop-1440.png) | [Снимок](storybook-components-admin-adminfilterbar--materials-desktop-390.png) |
| `components-админка-adminstates--error-desktop` | [Снимок](storybook-components-admin-adminstates--error-desktop-1440.png) | [Снимок](storybook-components-admin-adminstates--error-desktop-390.png) |
