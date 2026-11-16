# Roles and gotchas

What the code does not tell a verifier: who to sign in as, what a light instance cannot do, what
must exist beforehand, and where the browser tool misleads. [SKILL.md](SKILL.md) owns the steps.
Routes, controls and texts of a feature come from the code and from fresh snapshots.

## Roles on a light instance

Every `pnpm stand:light up` seeds the same people, under names nobody bears, so a screenshot shows
no real person. The product has one permission, `platform:admin`: no separate author or operator.

| Role | Who | Take it for | Sign in |
|---|---|---|---|
| `owner` | «Владелец Тестов», `platform:admin` | authoring and every admin page | `O open "$(V address owner /authoring)"` |
| `holder` | «Покупатель Тестов», holds the demonstration and synthetic learning Products | what a buyer sees after the purchase | `H open "$(V address holder /account)"` |
| `learner` | «Участник Тестов», no paid access, synthetic Telegram linked, pending purchase and active waiting-list membership | an unpaid member | `L open "$(V address learner /account)"` |
| `newcomer` | no name, terms not accepted, no profile row | the first sign-in | `N open "$(V address newcomer /account)"` |
| `guest` | nobody signed in | public pages | `G open "$(V address web /)"` |

## Roles on the shared stand

Open `http://127.0.0.1:3000/__local/accounts`, choose «Владелец», «Ученик с доступом»,
«Ученик без доступа» or «Гость», press «Выбрать аккаунт». The choice belongs to the browser
session: any helper session (`O`, `L`, `G`, etc.) can select any stand profile. The stand has
no equivalent of `newcomer`. Purchase setup and order are in
[local-stand accounts](../../../docs/runbooks/local-stand-accounts.md).

## What a light instance does not run

- Payment confirmation and fulfillment, mailed codes, notifications and background workers need
  the shared stand. The light seed creates only a pending purchase against its owned loopback bank.
- Real Telegram Bot API, group membership and message delivery. The learner is linked through an
  owned synthetic protocol provider; other roles are not linked by the seed.
- Real sign-in and sign-out at the identity provider. Sign-out lands on a notice «Локальная сессия
  завершена, но глобальный выход не подтверждён…»: the synthetic identity has no provider session.
- Video: the provider runs in test mode, so upload and playback prove nothing.

## Data that must exist beforehand

- The [light instance runbook](../../../docs/runbooks/local-stand.md#light-instance-per-agent)
  lists the current populated scenarios and their limits. Resolve persistence IDs through the
  running API or `V account <role>`; preview IDs and dates are separate projections.
- The owner's lists name a person by Telegram or verified email, never by the profile name. Only
  the learner has a seeded Telegram profile. Search the list by `V account <role>` and wait until
  one row is left: a text wait returns before filtering finishes, and a click by name takes the
  first row.
- On the shared stand, when «Ученик без доступа» already holds the product, report the scenario
  as not exercised; granting or revoking to make room is the owner's call. Close the Telegram
  connection dialog if it appears: a local purchase does not need it.
- `accounts.legal_acceptances.document_text` holds a whole document: select named columns only.

## Where the browser tool misleads

- Pages render a loading shell first («Загрузка …», «Загружаем …»). Wait for the text the
  scenario needs before reading the page.
- A page does not follow another role's action; open the address again. The home feed can lag a
  few seconds behind a publication; reopen `/` before reporting a miss.
- `snapshot -i` lists controls only; read a status line from `snapshot -s main`. While a dialog
  such as «Добро пожаловать» is open, `snapshot -s main` returns the dialog.
- Dialogs are native: select `dialog[open]`, not `[role=dialog]`. A dialog's submit can bear the
  page button's name, and `find role button` presses the page one: submit with
  `dialog[open] button[type=submit]`. `:has-text()` is not supported.
- A list of options stays open until one is chosen; wait for `[role=listbox]` to disappear
  before opening the next list.
- Material action buttons exist twice, at the top and at the end; `find role` acts on the first.
  For the second set, scope the lookup to `nav[aria-label="Действия в конце материала"]`.
- The cookie notice covers controls near the bottom of reader pages and `/account` until
  «Понятно» is pressed; `/authoring` has none.
- In a window lower than about 720 px the editor's «На весь экран» covers «Опубликовать» and the
  click is refused as covered (#2223). Scrolling to the top also exposes «Опубликовать».
- Save indicators («Сохранено сейчас», «Не сохранено», «Без изменений») change within seconds, and
  `wait --text "Сохранено"` also matches an earlier save. Assert on what stays: a heading, a
  button's new name, a row.
- The page shows some values in guillemets that `get text` and `wait --text` return without them.
- After going back, an address can carry a query; a URL pattern that omits it may not match.
  In that case wait for the resulting text.
- A publication rejection notice stays on screen until the next publication.
- A clip holds less time than the wall clock: pauses without repaints are short in it.
- Each launch prints a notice that the tool's Chrome is behind the stable release; it does not
  affect the run.
