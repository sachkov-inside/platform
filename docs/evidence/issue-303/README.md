# Экран подтверждения Telegram-входа

Задача: [#303](https://github.com/sachkov-inside/platform/issues/303).
База реализации и review: `5447fc6` (принятый функциональный вход #299).

Одна presentation implementation принадлежит Logto:
`infra/identity/logto/fork/packages/core/src/routes/inside-telegram-view.ts`.
Storybook импортирует её через fixture adapter `Patterns/Identity/Telegram sign-in`.
Состояния: ожидание, загрузка, подтверждение, отказ, истечение срока, использованный запрос,
выключение, недоступность и повтор подключения при потере связи.

## Воспроизводимые проверки

```bash
pnpm --filter @inside/web exec vitest run --config vitest.config.mts --project=storybook src/workshop/telegram-sign-in.stories.tsx
CAPTURE_TELEGRAM_EVIDENCE=1 pnpm --filter @inside/web exec vitest run --config vitest.config.mts test/module/telegram-sign-in.test.ts
node --test scripts/telegram-sign-in-theme.test.mjs
```

Файлы `<status>-1440.png` и `<status>-320.png` получены из настоящих HTML и polling script,
которые отдаёт Logto, в изолированном HTTP test fixture. Это синтетические состояния, а не
подтверждения реального бота. Тест проверяет WCAG 2 A/AA и 2.1 AA через axe, отсутствие
горизонтального переполнения, клавиатурный фокус и геометрию кнопки при polling, восстановление
после HTTP 503, возврат после отказа, автоматический callback и reduced motion.

Цвета и локальные Manrope fonts генерируются из принятых Platform foundations; drift проверяет
tooling test. В production нет импорта Storybook или fixture adapters.

## Приёмка

Визуальное согласование владельцем и merge GO пока не получены. Изменения подготовлены в task
branch для review. Production activation и реальные Telegram-сообщения не выполнялись.
