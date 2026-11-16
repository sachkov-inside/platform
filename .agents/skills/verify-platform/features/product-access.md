# Product access by the owner

The owner gives a person a product from that person's card, revokes it and restores it. A product
opens its closed materials to the person at once and lists itself in their account; a revoke
closes them again and keeps the history.

## Sub-features

- `access-grant` grants a product with a reason.
- `access-open` opens the product's closed material to the learner.
- `access-revoke` revokes the product with a reason.
- `access-closed` closes the material again for the learner.
- `access-restore` restores a revoked product.

## How to get to it (user POV)

- Owner: «Люди» in the admin navigation (`/authoring/people`), the person's row, then
  «Выдать продукт» at the top of the card.
- Owner: the row's menu in the people list: `O open "$(V address owner /authoring/people)"`,
  `O find role searchbox fill "$(V account learner)"`,
  `O wait --fn "document.querySelectorAll('tbody tr').length === 1"`,
  `O find role button click --name "Действия с «Без имени и email»"`,
  `O find role menuitem click --name "Открыть карточку"`; it leads to the same card.
- Owner: a product's tab «Ученики» (`/authoring/products/<id>?tab=learners`, reached from
  «Продукты»), then «Выдать продукт» *(not yet driven)*.
- Learner: the closed material's address, and «Мои продукты» on `/account`.

## Driving it with agent-browser

Preconditions: the baseline; the learner holds no product
(`V sql "select count(*) from account_rights.product_access where account_id = '$(V account learner)'"`
returns `0`). The holder's seeded product is another person's row.

- **Before (`access-closed`).** `L open "$(V address learner /materials/developer-pipeline-bez-poteri-konteksta)"`,
  `L wait --text "Продолжение для участников"`: the paywall is shown and «Изучено» is disabled.
- **Open the card.** `O open "$(V address owner /authoring/people)"`,
  `O find role searchbox fill "$(V account learner)"`,
  `O wait --fn "document.querySelectorAll('tbody tr').length === 1"`; one row is left.
  `O find role link click --name "Без имени и email"`, `O wait --text "Выдать продукт"`. The card
  says «У человека пока нет продуктов. Выдать продукт можно кнопкой вверху карточки.»
- **Grant (`access-grant`).** `O find role button click --name "Выдать продукт"`, `O wait 'dialog[open]'`,
  `O find role radio click --name "Создание Platform Inside"`, `O find role radio click --name "Подарок"`,
  `O click 'dialog[open] button[type=submit]'`, `O wait --text "Доступ выдан."` The card lists
  «Создание Platform Inside» with «Доступ открыт», «Выдача владельцем» and the history line
  «Выдача … Причина: Подарок».
- **Learner sees it (`access-open`).** Open the material address in `L` again and
  `L wait --text "Закрытое содержимое для участников."` The paywall region is gone and «Изучено»
  is enabled. Second view: `L open "$(V address learner /account)"`, `L wait --text "Мои продукты"`. `L snapshot -s main`
  lists the product with «Доступ открыт».
- **Revoke (`access-revoke`).** `O find role button click --name "Отозвать доступ к «Создание Platform Inside»"`,
  `O wait 'dialog[open]'`, `O find role radio click --name "Выдано по ошибке"`,
  `O find role button click --name "Отозвать доступ"`, `O wait --text "отозван"`. The card shows
  «Доступ к «Создание Platform Inside» отозван.», «Доступ отозван», the button
  «Восстановить доступ к «Создание Platform Inside»» and a new first history line
  «Отзыв … Причина: Выдано по ошибке» above «Выдача».
- **Learner loses it (`access-closed`).** Open the material address in `L` again and
  `L wait --text "Продолжение для участников"`. `/account` keeps the product under
  «Мои продукты» with «Доступ отозван».
- **Restore (`access-restore`).** `O find role button click --name "Восстановить доступ к «Создание Platform Inside»"`,
  complete the dialog, and check the learner's material opens again.
- **Side effects.**
  `V sql "select p.slug, a.revoked_at is not null as revoked, a.revision from account_rights.product_access a join products.products p on p.id = a.product_id where a.account_id = '$(V account learner)'"`
  returns `platform-inside,f,1` after the grant and `platform-inside,t,2` after the revoke;
  `V sql "select kind, reason from account_rights.product_access_actions where account_id = '$(V account learner)' order by recorded_at"`
  returns one row per action with its reason.

## Gotchas

- The dialog's submit is named like the page button, «Выдать продукт»; `find role button` would
  press the page button. Submit with `dialog[open] button[type=submit]`.
- The dialog is a native `<dialog>`: select it as `dialog[open]`, not `[role=dialog]`.
- Only «Создание Platform Inside» has a closed material in the seed. Granting another product
  changes the card and the rows but opens nothing new to read.
- The learner's page does not update by itself; open the address again after each owner action.
- The restore dialog was not driven when this file was written; take its controls from a snapshot.
- The product-side dialog «Выдать «<продукт>»» finds the person through «Найти человека», and the
  seeded learner has no name or email; search by the ID from the card's «Скопировать ID».
- History lines name the acting owner «Аккаунт без имени и email», the same label the learner has.
- Without the search the list has three rows with the same name, and a click by name takes the
  first. A text wait returns before the list is filtered; wait for one row.
- The grant takes about 7 s on screen; let the result stand a few seconds before `record stop`.
- The page shows a reason in guillemets; the page text read by `get text` or `wait --text` has
  none.
- Telegram group membership follows product access on the shared stand only; the light instance
  runs no workers.
