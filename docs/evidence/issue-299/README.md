# Telegram sign-in evidence

Локальный Logto `1.41.0-inside.3`, реальный Platform и provider из Telegram PR #25.
Доставка Telegram выключена; webhook updates синтетические. Это функциональная проверка,
не owner visual acceptance и не проверка настоящего Bot API.

- `telegram-waiting-desktop.png`: реальный экран ожидания, 1440 × 1024.
- `telegram-waiting-mobile.png`: тот же экран, ширина 390; горизонтального переполнения нет.
- `telegram-expired-mobile.png`, `telegram-disabled-mobile.png`, `telegram-unavailable-mobile.png`:
  presentation fixtures на реальной странице Logto. Серверная семантика этих состояний отдельно
  проверяется provider PostgreSQL tests и подписанными JWT tests.

Сквозные Playwright tests проверяют регистрацию, refresh после 60-секундного access token,
выход, повторный вход, отказ, чужой browser context, email → явную Telegram-привязку → вход
в тот же приватный профиль и два одновременных первых Logto interaction для одной identity.
Скриншоты обновлены после решения владельца 2026-09-06: одна кнопка «Открыть бота»,
короткий статус, без длинных предупреждений и сверки числа. Start tokens, browser secret,
credentials, callback URLs и traces не сохраняются.

Визуальная интеграция: [#303](https://github.com/sachkov-inside/platform/issues/303).
Воспроизведение: [runbook](../../verification/telegram-sign-in-local.md).


Дополнение: `unified-sign-in-desktop.png` (1440 × 1000) и
`unified-sign-in-mobile.png` (390 × 844) показывают общий экран входа после удаления
«Ещё не зарегистрированы?» / «Создать аккаунт». Новый email через Mailpit проверен до
создания Account, входа и выхода; отдельного шага регистрации нет. Эти два снимка получены
на локальном стенде с подключённым тестовым ботом, без отправки сообщений Telegram.
