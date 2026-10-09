# Platform #1196: сворачиваемые врезки

Функциональная проверка временного semantic UI; визуальное принятие принадлежит
[интеграции #1278](https://github.com/sachkov-inside/platform/issues/1278).

## Storybook

Снимки production-owned `MaterialBodyView` из story
`entities-material-body--collapsible-callouts`, 09.10.2026, commit `73d9b7e9`.
Первый совет раскрыт или свёрнут; вложенный совет имеет `collapse: expanded`.
Старая врезка не имеет поля `collapse` и остаётся обычным `aside`.

- [Desktop 1440 × 1024, раскрыто](callout-desktop-expanded.png).
- [Mobile 390 × 844, раскрыто](callout-mobile-expanded.png).
- [Mobile 390 × 844, свёрнуто](callout-mobile-collapsed.png).

MCP `test-run` с `a11y: true` прошёл для семи stories:
`entities-material-body--collapsible-callouts`,
`entities-material-body--collapsible-callouts-mobile`,
`pages-material-reader--collapsible-advice`,
`pages-material-reader--collapsible-advice-mobile`,
`pages-product-task--format-c`, `pages-product-task--format-c-mobile`,
`pages-authoring-material-editor--imported-collapsible-advice`.

В браузере проверены Enter и Space на `summary`; при ширине 390
`document.documentElement.scrollWidth` не превышал `clientWidth`.
Storybook dev server и браузер `platform-1196` остановлены после проверки.

## Настоящий импорт

`pnpm smoke:fullstack` с `FULLSTACK_TEST_GREP='a guest reads an imported c Task'`
завершился с exit 0. Сценарий `apps/web/test/fullstack/product-task-c.spec.ts`
прошёл на desktop Chromium и mobile Chromium. Синтетический пакет импортирован
через `syncLocal` в отдельные PostgreSQL и RustFS. Повторная синхронизация того же
пакета сохранила тела. Действующие Reader и Task c проверены на начальное состояние,
мышь, Enter, Space, вложенную врезку, ссылку и изображение внутри раскрытого тела.
Axe не нашёл serious/critical нарушений в `main` после раскрытия.

Это проверка синтетического пакета. Настоящий курс и production не затронуты.
