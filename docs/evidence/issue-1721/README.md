# Админка: люди, карточка человека и действия с доступом

Задача [#1721](https://github.com/sachkov-inside/platform/issues/1721) спецификации
[#1717](https://github.com/sachkov-inside/platform/issues/1717), веб-часть (список людей, карточка,
выдача, отзыв, восстановление, группа «Люди» в общем поиске). Production visual gate по разделу
«Визуальная приёмка»: Storybook и живой маршрут на 390 и 1440 px, доступность, отсутствие
горизонтальной прокрутки. Visual GO владелец даёт по итоговому интегрированному результату.

Снимки сделаны на коде `86397ec3757f7646e5f8fd64998160ee8f0abc48`. Имена, адреса, продукты и даты
вымышлены.

## Живой маршрут

Production-сборка web (`next build`) против тестового HTTP-бэкенда набора навигации
(`apps/web/test/navigation/fake-backend.mjs` с `people-backend.mjs`), а не общего стенда. Chromium
1440 × 1024 и мобильный Chromium 390 × 844. Снимки делает
`apps/web/test/navigation/authoring-people.spec.ts` при `CAPTURE_PEOPLE_EVIDENCE=1` и
`UPDATE_EVIDENCE=issue-1721`; перед каждым снимком тот же тест проверяет
`scrollWidth === clientWidth` и Axe по всей странице вместе с каркасом (нарушений 0, иначе тест
падает). Снимки компьютера показывают всю страницу; снимки телефона и окна отзыва показывают один
экран, как его видит человек, с нижней панелью на её месте.

| Состояние | Компьютер, 1440 px | Телефон, 390 px |
| --- | --- | --- |
| Список людей | [Снимок](live-list-desktop-chromium.png) | [Снимок](live-list-mobile-chromium.png) |
| Карточка человека, все блоки | [Снимок](live-card-desktop-chromium.png) | [Снимок](live-card-mobile-chromium.png) |
| Окно «Отозвать» с причиной «Другое» и последствием | [Снимок](live-revoke-dialog-desktop-chromium.png) | [Снимок](live-revoke-dialog-mobile-chromium.png) |

Тот же набор на обеих ширинах проверяет поведение без снимков: фильтры продукта и состояния в
адресе и после перезагрузки, «Сбросить», поиск по email, курсор «Дальше» и «К началу списка»,
перенаправление `/authoring/access` в «Люди», «поиск по имени временно недоступен», выдачу с
подсказкой «ничего не изменит», отзыв с обязательной заметкой для «Другое» и фокусом на «Отмена»,
восстановление с фокусом на причине, конфликт ревизии до отзыва и при восстановлении с «Обновить
данные», блоки, которые не ответили, пустой список, сбой с кодом обращения, неизвестного человека
и группу «Люди» в `⌘K` с переходом в карточку. Результат: 16 из 16
(`PRODUCTION_WEB_SKIP_BUILD=1 npx playwright test --config playwright.navigation.config.ts
test/navigation/authoring-people.spec.ts`).

## Storybook

Собранный Storybook (`pnpm build-storybook`), история после её `play`. Снимки и проверки делает
`apps/web/test/evidence/capture-people.mjs` (`UPDATE_EVIDENCE=issue-1721`): для каждой ширины
`scrollWidth === clientWidth` и Axe внутри `main` страницы, корня истории для окон и всего документа
для поиска; нарушений 0 ([проверки](storybook-checks.json)). Storybook и маршрут импортируют одни и
те же модули.

| История | 1440 px | 390 px |
| --- | --- | --- |
| `pages-authoring-люди--mobile` (имя, без Telegram, неизвестные контакты) | [Снимок](storybook-people--list-1440.png) | [Снимок](storybook-people--list-390.png) |
| `pages-authoring-люди--long-list` (длинные имена, курсор) | [Снимок](storybook-people--long-list-1440.png) | [Снимок](storybook-people--long-list-390.png) |
| `pages-authoring-люди--name-search-unavailable` | [Снимок](storybook-people--name-search-unavailable-1440.png) | [Снимок](storybook-people--name-search-unavailable-390.png) |
| `pages-authoring-люди--empty` | [Снимок](storybook-people--empty-1440.png) | [Снимок](storybook-people--empty-390.png) |
| `pages-authoring-карточка-человека--all-blocks` (отозванный продукт, история) | [Снимок](storybook-card--all-blocks-1440.png) | [Снимок](storybook-card--all-blocks-390.png) |
| `pages-authoring-карточка-человека--unavailable-blocks` (сдачи без права) | [Снимок](storybook-card--unavailable-blocks-1440.png) | [Снимок](storybook-card--unavailable-blocks-390.png) |
| `pages-authoring-карточка-человека--revoke-product-mobile` (окно отзыва) | [Снимок](storybook-card--revoke-dialog-1440.png) | [Снимок](storybook-card--revoke-dialog-390.png) |
| `pages-authoring-карточка-человека--revision-conflict-mobile` | [Снимок](storybook-card--revision-conflict-1440.png) | [Снимок](storybook-card--revision-conflict-390.png) |
| `components-админка-действия-с-доступом--grant-active` | [Снимок](storybook-dialog--grant-1440.png) | [Снимок](storybook-dialog--grant-390.png) |
| `components-админка-действия-с-доступом--restore` | [Снимок](storybook-dialog--restore-1440.png) | [Снимок](storybook-dialog--restore-390.png) |
| `patterns-каркас-админки--search-people-mobile` (группа «Люди») | [Снимок](storybook-search--people-1440.png) | [Снимок](storybook-search--people-390.png) |

## Клавиатура, фокус и роли

- Список: таблица с подписью «Люди, новые сверху» от 40rem колонки, список `ul` с тем же именем
  ниже; строку открывает настоящая ссылка, а «⋯» служит кнопкой меню с именем человека. История
  `Список · клавиатура` проверяет порядок: поиск, затем выбор продукта.
- Карточка: `h1` с подписью человека, навигация «Разделы карточки» с якорями, разделы `section`
  со своими `h2`, продукт показан как `article` со своим `h3`; кнопки «Отозвать» и «Восстановить» называют
  продукт в доступном имени.
- Окна: нативный модальный `dialog` с именем из заголовка; у отзыва первый фокус на «Отмена», у
  восстановления на поле причины, у выдачи на первом продукте; Escape не закрывает окно во время
  выполнения; ошибки полей связаны через `aria-describedby`.
- Уведомление об успехе приходит в постоянную область `status`, отказ и устаревшая карточка
  приходят в `alert`.

## Ограничения

- Full-stack сценарий `test/fullstack/enrollment.spec.ts` переписан на карточку человека, но в этой
  работе не запускался: ему нужен общий стенд.
- Снимки показывают данные тестового бэкенда; данные живого Telegram и Billing на них не видны.
