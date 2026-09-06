# Рассылки из Telegram — #317

Автор готовит текст и медиа в `/admin` бота, выбирает сохранённый пост в веб-админке,
настраивает URL-кнопки и их ряды, запрашивает образец себе и добавляет снимок в рассылку.
Замена части явная и сохраняет выбранную цель при перестановке. Аудитория, расписание,
запуск и аналитика остаются в общей странице `/authoring/communications/broadcasts`.

Production и Storybook используют одни `PostLibrary`, `BroadcastEditor`, `BroadcastList`,
`AnalyticsPanel` и `EntryHistory`. Текст в веб-админке доступен для чтения; настоящий вид
форматирования проверяется образцом в Telegram.

## Актуальные снимки

Снято 2026-09-06 с реализацией `7246d01145f54db5dc4cdc0559280f5d5639521c`.
Последующие изменения тестовых типов и evidence не меняют показанный интерфейс.

| Поверхность | Desktop | Mobile |
|---|---|---|
| Выбор поста и настройка кнопок в Storybook | [Полная страница](telegram-posts-desktop.png) | [390 px](telegram-posts-390.png), [320 px](telegram-posts-320.png) |
| Редактор в приложении | [Начало](desktop-chromium-editor-top.png), [настройки](desktop-chromium-editor-settings.png) | [Начало](mobile-chromium-editor-top.png), [настройки](mobile-chromium-editor-settings.png) |
| Аналитика в приложении | [Счётчики](desktop-chromium-analytics.png), [контакты](desktop-chromium-contacts.png) | [Счётчики](mobile-chromium-analytics.png), [контакты](mobile-chromium-contacts.png) |

Storybook использует синтетические посты. Приложение работает через настоящий Next BFF,
Nest и PostgreSQL; только внешний Telegram provider заменён тестовым транспортом.
Снимки `editor-*.png`, `list-*.png`, `analytics-*.png` и `storybook-checks.json` сохранены
как история первоначального оформления на `1844e810`; они не подтверждают новый выбор постов.

## Проверка и воспроизведение

- `pnpm check`: документация, контракты, lint, types, guardrails, tests, browser routes,
  production build, standalone runtime config и Storybook build.
- Focused Storybook: `pnpm --filter @inside/web exec vitest run --config vitest.config.mts
  --project=storybook src/_pages/communications/ui/broadcast-editor.stories.tsx
  src/_pages/communications/ui/post-library.stories.tsx` — 27 сценариев. Включены состояния
  библиотеки, кнопки, образец, выбор поста, readonly source, замена после перестановки/удаления,
  клавиатура и светлая/тёмная темы.
- `node scripts/communications-browser-smoke.mjs`: выбор поста → правка кнопки → образец →
  draft → launch → pause → resume → cancel; история входов, HTTP authorization и tracking.
  Потеря ответа после принятого образца и reload повторяют прежние operationId/revision.
  Сохраняются native entities и ряды кнопок. Axe проверяет редактор и итоговую страницу;
  mobile также проверяет 320 px и 200% текста без горизонтального переполнения.
- Браузерный визуальный просмотр: desktop, 390 и 320 px. Кнопки, ссылки и настройки помещаются;
  на узком экране аудитория и расписание идут после сообщения.
- Standards и Spec review от `2980d4663a3b66abd5b588d546cb090ed09183d9` до `7246d011` —
  оба пройдены. Результаты финального полного check и CI записаны в PR #338.

Для просмотра: `pnpm storybook`, `Pages/Communications/Рассылка` → `Telegram Posts` или
`Telegram Posts Mobile`; отдельные состояния — `Посты из Telegram`. Agentation доступен
для замечаний владельца.

## Границы

Визуальная приёмка владельцем ожидается. Реальный Telegram transport, внешний вид сообщения
в приложении Telegram, production enablement и отправка на настоящую аудиторию не проверялись.
Merge и production запуск требуют отдельных решений. Очистка данных браузера удаляет
сохранённый идентификатор неподтверждённого образца. Переход по пересланной ссылке не доказывает
личность читателя или прочтение.
