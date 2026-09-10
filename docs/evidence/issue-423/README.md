# Home layout — #423

Проверено на реализации `af8cb89f`, от `b8b0e050`, 8 сентября 2026.

Заметки используют две колонки при ширине Home container от 48rem, одну ниже этой границы. Единственная заметка центрируется. Правило отступов заголовков привязано к `home-section-heading` и больше не захватывает содержимое плашки подписки; первый абзац плашки не добавляет верхний margin.

## Исполнимая проверка

- `PLAYWRIGHT_PORT=3423 pnpm check` — passed: документация, API drift, lint, typecheck, guardrails, tooling/backend/web/Storybook tests, Playwright, production и Storybook builds.
- Standards и Spec review относительно `b8b0e050` — pass, findings отсутствуют.
- Storybook `Pages/Home/Guest/Ready` и живой маршрут `/` с development seed: 1440×1024, 390×844, 1280×1024 с root font-size 200%.
- [Измерения DOM](geometry.json): лента равна ширине секции; на desktop две колонки, на mobile и при увеличенном тексте одна; верхние margin контейнера текста и первого абзаца плашки равны нулю; горизонтального overflow нет.
- Скан Impeccable layout — findings отсутствуют.

## Изображения живого приложения

[Заметки desktop](live-notes-desktop.png) · [Заметки mobile](live-notes-mobile.png)

[Плашка desktop](live-invitation-desktop.png) · [Плашка mobile](live-invitation-mobile.png)

## Изображения Storybook

[Заметки desktop](storybook-notes-desktop.png) · [Плашка mobile](storybook-invitation-mobile.png)

## Границы результата

Локальный web-контейнер обновлён из task worktree; API, тестовая база и временные роли сохранены. Seed-контент не является редакционным материалом автора. Real-provider, production и owner visual GO не подтверждаются этой проверкой. Авторский закреп с изображением автора — отдельная функциональная задача и не входит в #423. Merge требует явного решения владельца.
