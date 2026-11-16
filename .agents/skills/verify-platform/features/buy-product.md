# Buy a product

A signed-in person without the product pays for it once through the bank and receives it at once:
the closed materials open, and the owner sees the payment.

## Sub-features

- `buy-offer` shows the price and the purchase terms before payment.
- `buy-contact` confirms the receipt address by a mailed code.
- `buy-pay` pays on the bank double and returns with the product open.
- `buy-owner` shows the confirmed payment to the owner.
- `buy-declined` leaves the product closed after a bank refusal.

## How to get to it (user POV)

- «Приобрести курс» on a closed material's paywall.
- The product page `/products/<slug>`, then the buy action.
- The direct address `/products/<slug>/buy`.
- An individual payment link `/payment/links/<id>` issued by the owner.

## Driving it with agent-browser

Preconditions: the owner's request to buy on the stand for this verification, because the
purchase stays in the owner's data; the **shared stand**, reserved for this worktree and `ready` on this commit
([SKILL.md](../SKILL.md), Launch); its bank double at `http://127.0.0.1:8090` and mail capture at
`http://127.0.0.1:8025`; the profile «Ученик без доступа» does not hold the product. A light
instance shows the offer only: its bank and mail are switched off.

- **Role.** `L open http://127.0.0.1:3000/__local/accounts`,
  `L find role radio click --name "Ученик без доступа"`, `L find role button click --name "Выбрать аккаунт"`.
- **Offer (`buy-offer`).** Open a product on sale from the stand's home and follow its buy action
  to `/products/<its slug>/buy`; the stand's catalogue is the owner's, so the map names no slug. The steps list reads
  «Вход», «Оплата», «Доступ»; the form «Оплата продукта» shows the price, «Разовая оплата», the
  disclosure «Условия и документы покупки» and the button «Оплатить <сумма> ₽» with
  «Нажимая «Оплатить», вы принимаете оферту разовой покупки.» A light instance proves this step for
  `/products/platform-inside/buy` (30 ₽).
- **Receipt address (`buy-contact`).** Enter the address in «Почта для чека», request the code,
  read it from the newest message in the mail capture and confirm it.
- **Pay (`buy-pay`).** Press «Оплатить …», wait for the bank double's page (`**/pay/*`),
  `L find role button click --name "Оплата прошла" --exact`, and wait for the heading
  «Продукт открыт». Second view: the product's closed material now shows its body.
- **Owner (`buy-owner`).** Switch the profile to «Владелец» in the owner session and open
  `/authoring/sales/payments`: the purchase is listed as confirmed.
- **Declined (`buy-declined`).** On the bank double choose «Банк отказал»; the product stays
  closed and the purchase can be started again.
- **Side effects.** The payment row in `/authoring/sales/payments`, the receipt message in the
  mail capture and the product under «Мои продукты» on the buyer's `/account`.

## Gotchas

- This recipe has not been driven end to end with this harness. Its handles come from
  `apps/web/test/fullstack/buyer-journey.spec.ts`, the bank double's outcome labels and
  [stand accounts](../../../../docs/runbooks/local-stand-accounts.md); only `buy-offer` was observed,
  on a light instance. Take each handle from a fresh snapshot and correct this file on the first
  full run.
- A purchase is permanent on the stand: an account that bought the product keeps it, and the
  stand's data belongs to the owner. When «Ученик без доступа» already holds the product, report
  the journey as not exercised with that reason; granting or revoking on the owner's stand to
  make room needs the owner's request.
- Evidence from the shared stand stays on the machine and out of the PR.
- Other bank double outcomes are «Покупатель отменил», «Истёк срок оплаты» and
  «Непонятный ответ банка»; the last one must leave the attempt for reconciliation.
- Close the Telegram connection dialog if it appears; a local purchase does not need it.
