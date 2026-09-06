# Экран подтверждения Telegram-входа

Задача: [#303](https://github.com/sachkov-inside/platform/issues/303).
База реализации и review: `5447fc6` (принятый функциональный вход #299).

Одна presentation implementation принадлежит Logto:
`infra/identity/logto/fork/packages/core/src/routes/inside-telegram-view.ts`.
Storybook импортирует её через fixture adapter `Patterns/Identity/Telegram sign-in`.
Состояния: ожидание, загрузка, подтверждение, отказ, истечение срока, использованный запрос,
выключение, недоступность и повтор подключения при потере связи.

## Проверки

```bash
pnpm --filter @inside/web exec vitest run --config vitest.config.mts --project=storybook src/workshop/telegram-sign-in.stories.tsx
pnpm --filter @inside/web exec vitest run --config vitest.config.mts test/module/telegram-sign-in.test.ts
node --test scripts/telegram-sign-in-theme.test.mjs
```

Тест проверяет WCAG 2 A/AA и 2.1 AA через axe, отсутствие горизонтального переполнения,
клавиатурный фокус и геометрию кнопки при polling, восстановление после HTTP 503, возврат после
отказа и постоянной потери связи, автоматический callback и reduced motion. По умолчанию
исполняются настоящие HTML и script в изолированном HTTP fixture.

Образ `1.41.0-inside.4` собран полным `docker build`, включая upstream TypeScript checks,
Experience build и core tsup. Для UI-проверки запущен отдельный Logto с собственной временной
PostgreSQL, без подключения к рабочему стенду и Telegram provider.

Файлы `logto-<status>-1440.png` / `logto-<status>-320.png` показывают настоящий маршрут и script
из этого образа. Только ответы status подставлены браузерным тестом. Переход `/sign-in` проверяется
через навигационную fixture, поскольку в визуальном стенде нет настоящей Logto interaction.
Сервер самостоятельно отдаёт `unavailable` без interaction. Синтетический callback не создаёт
Account или сессию.

`storybook-pending-1440.png` и `storybook-pending-320.png` получены из Storybook той же ветки;
Agentation включён. Для повторения теста с уже запущенными изолированными серверами:

```bash
TELEGRAM_UI_ORIGIN=http://localhost:3633 STORYBOOK_UI_ORIGIN=http://localhost:6303 CAPTURE_TELEGRAM_EVIDENCE=1 pnpm --filter @inside/web exec vitest run --config vitest.config.mts test/module/telegram-sign-in.test.ts
```

Результат: все 9 stories и 5 browser checks на собранном Logto/Storybook прошли. Standards и Spec
review от `5447fc6` прошли после исправления возврата при длительной потере связи.

Цвета и локальные Manrope fonts генерируются из принятых Platform foundations; drift проверяет
tooling test. В production нет импорта Storybook или fixture adapters.

## Приёмка и границы проверки

2026-09-06 владелец принял оформление с голубым акцентом Telegram и дал разрешение на merge
сообщением «апрув». Production activation и реальные Telegram-сообщения не выполнялись.
Реальный пользовательский путь с ботом повторно не проверялся: его протокол сохраняется из
принятого #299. Изолированный визуальный стенд подтверждает оформление и исполнение собранного
script, но не заменяет сквозную проверку настоящего входа.
