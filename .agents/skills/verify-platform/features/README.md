# Platform verification map

The maintained source for verifying user-facing behaviour of Platform web. Read this index, then
use the matching feature file as the recipe. [SKILL.md](../SKILL.md) owns launch, doctor, evidence,
verdict and cleanup.

## Baseline

- A light instance of this worktree, started by this run, with a passing doctor. Its database is
  fresh on every `up`: the seeded demonstration catalogue, an owner and one learner with no
  products.
- `V="node scripts/verify-platform.mjs"`; `O` means `$V browser --role owner --`, `L` means
  `$V browser --role learner --`, `G` means `$V browser --role guest --`, and `$V sql` reads the
  instance's database. Addresses come from `$V address <owner|learner|web> <path>`.
- Each role's session is set to 1440×900 once.

Seed facts the recipes rely on:

| Fact | Value |
|---|---|
| The one closed material | «Developer Pipeline без потери контекста», `/materials/developer-pipeline-bez-poteri-konteksta`, body «Закрытое содержимое для участников.» |
| Its product | «Создание Platform Inside», `/products/platform-inside`, price 30 ₽ |
| A free material in the home feed | «Проверяемая поставка», `/materials/proveryaemaya-postavka` |
| The learner in the owner's lists | «Без имени и email» |
| Authoring topic and formats | topic «Платформа»; formats «Видео», «Гайд», «Заметка» |

## Driving conventions

- Start each recipe from the baseline unless its preconditions say otherwise. A recipe that
  mutates needs no restore: `pnpm stand:light down` drops the database.
- Treat every quoted name as literal. Wait for the stated result before the next action.
- A mutation is proven by its row and by a second view, as each recipe names them.
- When a precondition is missing, report the failed step and the unmet precondition, and add the
  reason to the feature's Gotchas. Never weaken a journey to make it pass.
- A journey skipped at one entry point is not verified through another.

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
