# Account cabinet

A signed-in person accepts the terms on first sign-in and then manages the account at `/account`:
the name, the Telegram connection, the products they hold and the accepted documents.

## Sub-features

- `account-terms` asks a new account to accept the terms once.
- `account-name` saves the name.
- `account-products` lists held and revoked products.
- `account-sign-out` ends the session.

## How to get to it (user POV)

- The «Аккаунт» button in the header: `L find role button click --name "Аккаунт"`,
  `L find role menuitem click --name "Личный кабинет"`. The menu also has «Выйти».
- The direct address `/account`.
- Automatically after the first sign-in: `/welcome?returnTo=…`, then `/account`.

## Driving it with agent-browser

Preconditions: the baseline; the learner has not accepted the terms
(`V sql "select count(*) from accounts.legal_acceptances where account_id = '$(V account learner)'"`
returns `0`; the owner and the holder accepted them at seed).

- **Terms (`account-terms`).** `L open "$(V address learner /account)"`. A dialog
  «Добро пожаловать» links «условия использования» and «политике персональных данных».
  `L find role button click --name "Принять условия и продолжить"`, `L wait --url "**/account"`,
  `L wait --text "Личные данные"`. The heading is «Личный кабинет» with the role «Участник».
- **Name (`account-name`).** `L find label "Имя" fill "Проверяющий Ученик"`,
  `L find role button click --name "Сохранить имя"`, `L wait --text "Имя сохранено."` Second view:
  open `/account` again; «Проверяющий Ученик» stands under the heading «Личный кабинет» in place of «Участник», and
  the field keeps the value.
- **Products (`account-products`).** With no products the page has no region «Мои продукты».
  The holder has one: `H open "$(V address holder /account)"`, `H wait --text "Мои продукты"`;
  `H snapshot -s main` shows «Покупатель Тестов» under the heading and «Создание Platform Inside»
  with «Доступ открыт». After
  the owner grants one ([product access](product-access.md)) it lists the product with
  «Доступ открыт» and «Открыть продукт»; after a revoke, «Доступ отозван».
- **Sign out (`account-sign-out`).** `L find role button click --name "Выйти из аккаунта"`,
  `L wait --text "Войти через Telegram"`. The address is `/?authentication=logout-incomplete`, and
  `/account` then reads «Войдите, чтобы открыть личный кабинет.»
- **Side effects.**
  `V sql "select kind, document_version, screen, button_label from accounts.legal_acceptances where account_id = '$(V account learner)'"`
  returns `terms,1,first-sign-in,Принять условия и продолжить`;
  `V sql "select display_name from account_profiles.profiles where account_id = '$(V account learner)'"`
  returns `Проверяющий Ученик`.

## Gotchas

- `accounts.legal_acceptances.document_text` holds the whole document; select the named columns
  only.
- The owner's people list keeps showing the learner as «Без имени и email» after the name is
  saved (observed 2026-11-16): that list names a person by Telegram or email. Report it as a note
  when the change under verification is about names.
- The terms dialog appears on the first open of `/account`, not on `/`, a material or
  `/bookmarks`; `/learning` redirects to `/`.
- On a light instance sign-out lands on a notice «Локальная сессия завершена, но глобальный выход
  не подтверждён…»: the synthetic identity has no provider session to end. The shared stand has.
- «Подключить» Telegram, the receipt address and purchases need the shared stand.
