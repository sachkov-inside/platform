# Platform verification map

The maintained source for verifying user-facing behaviour of Platform web. Read this index, then
use the matching feature file as the recipe. [SKILL.md](../SKILL.md) owns launch, doctor, evidence,
verdict and cleanup.

## Baseline

- A light instance of this worktree, started by this run, with a passing doctor. Its database is
  fresh on every `up`: the seeded demonstration catalogue and the roles of
  [SKILL.md](../SKILL.md), step 3: the owner «Владелец Тестов», the holder «Покупатель Тестов»
  with «Создание Platform Inside», and a new learner with no name, no products and no accepted
  terms.
- The shell functions `V`, `O`, `H`, `L` and `G` from SKILL.md: the helper and the owner, holder,
  learner and guest browser sessions. `V sql` reads the instance's database, `V account <role>`
  prints a role's Account ID, and addresses come from `V address <owner|holder|learner|web> <path>`.
- Each role's session is set to 1440×900 after its first `open`. Reader pages show a cookie notice
  until «Понятно» is pressed; admin pages have none.

Seed facts the recipes rely on:

| Fact | Value |
|---|---|
| The one closed material | «Developer Pipeline без потери контекста», `/materials/developer-pipeline-bez-poteri-konteksta`, body «Закрытое содержимое для участников.» |
| Its product | «Создание Platform Inside», `/products/platform-inside`, price 30 ₽ |
| A free material in the home feed | «Проверяемая поставка», `/materials/proveryaemaya-postavka` |
| People in the owner's lists | two rows named «Без имени и email» (the list names a person by Telegram or email): the holder with «Создание Platform Inside», the learner with «Без продуктов». Search by `V account <role>` to get one row |
| Authoring topic and formats | topic «Платформа» (reader pages show it as «Platform»); formats «Видео», «Гайд», «Заметка» |
| A product programme | `/products/platform-inside/programme`: «Как устроен Inside Platform» (a free lesson, open to accounts with Telegram connected) and «Developer Pipeline без потери контекста» (closed) |

## Driving conventions

- Start each recipe from the baseline unless its preconditions say otherwise. A recipe that
  mutates needs no restore: `pnpm stand:light down` drops the database.
- Treat every quoted name as literal. Wait for the stated result before the next action.
- A mutation is proven by its row and by a second view, as each recipe names them.
- When a precondition is missing, report the failed step and the unmet precondition; the reason
  then goes into the feature's Gotchas in a PR. Never weaken a journey to make it pass.
- A journey skipped at one entry point is not verified through another. Entry points marked
  *(not yet driven)* have no steps: drive them from fresh snapshots and report the steps that
  worked, or report them as not exercised.
- Assert on text that stays: a heading, a button's new name, a row. A save status such as
  «Сохранено сейчас» changes within seconds.

## Feature entry contract

Each feature file has an H1, one paragraph on the user-visible behaviour, and four H2 sections in
this order: `Sub-features` (short IDs), `How to get to it (user POV)` (every entry point),
`Driving it with agent-browser` (preconditions, then labelled steps pairing the user action with
the exact command and the observable result) and `Gotchas`. Keep implementation out: name user
paths, stable handles, required state, commands and observable proof. When the application
changes a label, route or seed fact, change the file in the same PR.

## Features

- [Read a material](read-material.md): home feed, reading, bookmark, read mark, the closed
  material's paywall.
- [Product access by the owner](product-access.md): the owner grants, revokes and restores a
  product; the learner's closed material opens and closes.
- [Author a material](author-material.md): the owner drafts, fills required parameters, publishes;
  readers see it.
- [Account cabinet](account-cabinet.md): first sign-in terms, name, the product list.
- [Buy a product](buy-product.md): purchase through the bank double; shared stand only.
