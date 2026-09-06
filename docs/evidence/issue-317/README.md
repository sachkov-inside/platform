# Рассылки и аналитика — #317

Редактор разделён на сообщение и настройки отправки. На узком экране настройки идут после
сообщения. Список показывает аудиторию, расписание и состояние рассылки. Аналитика группирует
контакты бота, доставку и переходы; отдельно показывает задержку передачи событий. История
входов сохраняет первый и последний источники.

Production `/authoring/communications/broadcasts` и Storybook используют общие
`BroadcastEditor`, `BroadcastList`, `AnalyticsPanel` и `EntryHistory`. Tokens и Authoring shell
сохранены; транспорт, права, расписание и правила доставки не менялись.

## Снимки

Снято 2026-09-06 с implementation SHA `1844e81037246198ebfd2fb7d06add9d2bbe5ca0`.
Последующие изменения этой папки сохраняют evidence, не меняя реализацию.

| Поверхность | Desktop | Mobile |
|---|---|---|
| Редактор Storybook | [1440 px](editor-1440.png) | [390 px](editor-390.png), [320 px](editor-320.png) |
| Список Storybook | [1440 px](list-1440.png) | [390 px](list-390.png), [320 px](list-320.png) |
| Аналитика Storybook | [1440 px](analytics-1440.png) | [390 px](analytics-390.png), [320 px](analytics-320.png) |
| Редактор в приложении | [начало](desktop-chromium-editor-top.png), [настройки](desktop-chromium-editor-settings.png) | [начало](mobile-chromium-editor-top.png), [настройки](mobile-chromium-editor-settings.png) |
| Аналитика в приложении | [счётчики](desktop-chromium-analytics.png), [контакты](desktop-chromium-contacts.png) | [счётчики](mobile-chromium-analytics.png), [контакты](mobile-chromium-contacts.png) |

Снимки показывают реальные видимые области при прокрутке. Storybook использует синтетические
fixtures, приложение — настоящий Next BFF/Nest/PostgreSQL и тестовую замену Telegram provider.

## Проверка и воспроизведение

- `pnpm check`: документация, контракты, lint, types, guardrails, tests, browser routes,
  production build, standalone runtime config и Storybook build.
- `pnpm --filter @inside/web exec vitest run --config vitest.config.mts --project=storybook
  src/_pages/communications/ui/broadcast-editor.stories.tsx
  src/_pages/communications/ui/broadcast-list.stories.tsx
  src/_pages/communications/ui/analytics-panel.stories.tsx`: 35 stories, включая состояния,
  заготовку, предпросмотр без отправки, блокировку запуска несохранённого текста, пагинацию,
  клавиатуру и accessibility в светлой и тёмной темах.
- `node scripts/communications-browser-smoke.mjs`: draft → launch → pause → resume → cancel,
  история входов, HTTP authorization и tracking redirect. Native keyboard раскрывает ID через
  Enter и переводит Tab в текст. Axe проверяет редактор и итоговую страницу. На mobile также
  проверяются 320 px и 200% текста без горизонтального переполнения.
- [Дополнительные responsive/axe проверки Storybook](storybook-checks.json): редактор, список
  и аналитика на ширинах 1440, 390 и 320 px; по каждой — нет переполнения и WCAG A/AA violations.
- Standards и Spec review от `2980d4663a3b66abd5b588d546cb090ed09183d9`: без замечаний
  к реализации. Точные результаты проверки финального PR head хранятся в PR/CI.

Для визуального просмотра: `pnpm storybook`, каталог `Pages/Communications` → `Рассылка`,
`Список рассылок`, `Аналитика`. Agentation включён для замечаний владельца.

## Открытое решение и границы

Визуальная приёмка владельцем **ожидается**. Эти снимки и автоматические проверки не являются
owner visual GO. Merge требует отдельного разрешения. Реальных рассылок, production enablement,
проверок Telegram на настоящей аудитории и оплаты не выполнялось. Переход по пересланной ссылке
не подтверждает личность читателя или прочтение.
