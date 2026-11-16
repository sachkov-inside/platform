---
name: verify-platform
description: Verify a change in the running Platform web application as its user and return a PASS, PASS+NOTES or FAIL verdict with video, screenshots and observed side effects. Use when asked to verify a change in the real application.
---

# Verify Platform

You verify a change you did not write, in the running application, as its user. The output is a
**verdict** with **evidence** the owner can open. The steps run in this order; the helper is
`node scripts/verify-platform.mjs` (`--help` lists its commands), run from the worktree root.

Pick the journeys from the [feature map](features/README.md): the features the change touches,
and each entry point the map lists for them. An entry point the map marks as not yet driven has no
recipe: drive it from fresh snapshots and put the steps that worked into the verdict's notes, or
report it as not exercised. The verifier reports; the map changes in a PR of its own.

## 1. Launch

A **light instance** is this worktree's web and API on free loopback ports with its own freshly
seeded database. It needs no reservation and runs beside other worktrees' instances.

```bash
pnpm stand:light up        # prints the addresses when ready
```

Commit first: web is built once at `up`, so a later commit, checkout or edit of a web build input
(`apps/web`, `packages`, dependencies) needs `pnpm stand:light down` and `up`. Start one instance
at a time on the machine; the runbook's
[memory budget](../../../docs/runbooks/local-stand.md#memory-budget) says why. `up` refuses when the shared stand's PostgreSQL and object
storage are not running; it never starts containers, so report that as a blocker.

The instance is usable when the doctor passes, not when `up` returns.

Use the **shared stand** instead only when the journey needs what a light instance lacks: real
Logto sign-in, mail codes, the bank double, background workers, notifications or the owner's data.
It is one per machine and holds the owner's data. Follow the
[local-stand skill](../local-stand/SKILL.md): read `pnpm --silent stand status --json`, then run
`pnpm stand show --worktree "$PWD"` in the background, because a busy stand queues the command and
a tool timeout gives up the place. A foreign reservation stays; replacing it needs the owner's
request, so report the journey as not exercised. Drive the stand only when its status is `ready`
and its `Source` equals `git rev-parse HEAD`; the doctor below covers light instances only. The
stand keeps what a journey writes: a journey that leaves permanent data there, such as a
purchase, needs the owner's request for this verification. Roles there are chosen at
`http://127.0.0.1:3000/__local/accounts` (radios «Владелец», «Ученик с доступом»,
«Ученик без доступа», «Гость», button «Выбрать аккаунт»).

## 2. Doctor

```bash
node scripts/verify-platform.mjs doctor      # exit 0 only when every check passes
```

Read-only. It checks that the supervisor is alive and `ready`, that HEAD has not moved and no web
build input was written since the instance started, that the web and API ports are held by this instance's own
processes, that the API reaches its database and the home feed serves seeded materials, and that
the owner signs in with authoring rights and the other roles without. Run it before the first drive
and again whenever a page looks wrong. A failed check names its fix; drive nothing until all pass.

## 3. Drive

Every browser command goes through the helper. It runs `agent-browser` in this worktree's own
headless session for the role, and adds the launch settings a loopback page needs on this machine.

```bash
V() { node scripts/verify-platform.mjs "$@"; }     # define these in every shell command
O() { V browser --role owner -- "$@"; }
H() { V browser --role holder -- "$@"; }
L() { V browser --role learner -- "$@"; }
N() { V browser --role newcomer -- "$@"; }
G() { V browser --role guest -- "$@"; }

O open "$(V address owner /authoring/people)"      # sign in as owner and open the page
O set viewport 1440 900                            # once per session, after its first open
O snapshot -i -s main
O find role button click --name "Выдать продукт"
O wait --text "Доступ выдан."
```

- **Roles.** A light instance seeds the same people on every `up`, under names nobody bears, so
  a screenshot shows no real person. The product has one permission, `platform:admin`; there is
  no separate author or operator.

  | Role | Who | Take it for |
  |---|---|---|
  | `owner` | «Владелец Тестов», `platform:admin` | authoring and every admin page; the owner is the author |
  | `holder` | «Покупатель Тестов», holds «Создание Platform Inside» | what a buyer sees after the purchase |
  | `learner` | «Участник Тестов», a ready profile, no products | an ordinary member: reading, bookmarks, receiving a product |
  | `newcomer` | no name, terms not accepted | the first sign-in and an empty profile |
  | `guest` | nobody signed in | public pages |

  The owner signs in with `O open "$(V address owner /authoring)"`; `/authoring` answers
  «Страница не найдена» to everyone else. The other roles sign in to their cabinet:
  `H open "$(V address holder /account)"`, and likewise `L`/`learner` and `N`/`newcomer`; the
  guest opens `G open "$(V address web /)"`. A named role's name stands under the heading of its
  `/account`; the newcomer gets the welcome dialog there and has no profile row yet. Each role is its own session with its own cookies, so they stay signed in side by
  side. `V account <role>` prints a role's Account ID. On the shared stand the roles are the
  profiles of `/__local/accounts` named in step 1; they carry no fictional names yet (#2218).
- **Namespace.** When the machine's `agent-browser` rules name a namespace, export it as
  `AGENT_BROWSER_NAMESPACE` in each command; the helper passes it on.
- **Handles.** Act on roles and accessible names (`find role … --name`, `find label …`), or on a
  ref from a fresh `snapshot -i`. When two controls share a name (a page button and a dialog
  submit), scope by structure: `click 'dialog[open] button[type=submit]'`. `:has-text()` is not
  supported. Coordinates are never a handle.
- **Waits.** After each action wait for the text or URL the journey names (`wait --text`,
  `wait --url`), then snapshot. Pages render a loading shell first («Загрузка …», «Загружаем …»).
- **Viewport.** Set 1440×900. In the default short window the material editor's toolbar overlaps
  «Опубликовать».
- **First visit.** The newcomer's first open of `/account` shows «Добро пожаловать» in place of
  the cabinet (`snapshot -s main` returns the dialog), on every open until the terms are accepted;
  press «Принять условия и продолжить» and the cabinet opens by itself. Public pages, materials and `/bookmarks` do not ask. Reader pages and
  `/account` show a cookie notice in every session until «Понятно» is pressed: it covers controls
  near the bottom of the page.
- **Output.** `agent-browser` prints a notice that its Chrome is behind the stable release on
  each launch; it does not affect the run. `wait --text` prints the matched text. `snapshot -i`
  lists controls only; read a status line from `snapshot -s main`.
- **Routes.** Reader: `/`, `/materials/<slug>`, `/products/<slug>`, `/products/<slug>/buy`,
  `/bookmarks`, `/account`. Owner: `/authoring`, `/authoring/materials`, `/authoring/products`,
  `/authoring/people`, `/authoring/sales/payments`. The feature files carry the rest.

`agent-browser` is the one browser tool: when it cannot do a step, report the exact failing
command and its output.

## 4. Evidence

```bash
E="$(V evidence start)"   # once per run: creates .evidence/ and manifest.json for this commit
E="$(V evidence path)"    # the same directory, in every later shell command
```

Evidence lives in `.evidence/` in the worktree root, outside Git: the files and one
`manifest.json` that lists the scenarios. The manifest is self-sufficient: the PR is written
from it and its files are attached from it. A run of an earlier commit is replaced with
`V evidence start --reset`.

**Before recording, make sure the data is test data.** A light instance with a passing doctor
is: its database is this run's seed (the seeded materials carry the site's own name and author
picture, which are public). The shared stand holds the owner's accounts, purchases and
unpublished materials, and its roles have no fictional names (#2218): keep no file from it. Add
the scenario with `--source stand-test-data`, kind `none`, and say the result in words. The same
holds for any screen you doubt.

A **scenario** is one thing checked. Choose the kind of evidence for each scenario separately:

| Kind | When | Files |
|---|---|---|
| `video` | the proof is motion: a journey, a transition | one clip, 10–30 s as the aim, 30 s at most |
| `screenshot` | the proof is how a page looks at one moment | one; two (before, after) when an existing view changes |
| `table` | the proof is not on screen: rows written, a request and its answer | a CSV or Markdown table «action, expected, got» from the running server; the PR shows it as text |
| `numbers` | the proof is speed | a CSV or Markdown table «measure, before, after»; the PR shows it as text |
| `none` | no file may be kept, or nothing can be shown | none; the result in words |

A `numbers` scenario measures at least five runs of each side, before and after alternating, and
reports the median with the count of runs and their range as extra columns. It also proves that
the change took effect: a fact that differs between the two sides, such as a version or a flag.

GitHub attaches at most 10 MB per file, so record one short clip per scenario, never the whole
run in one file: start the recording right before the action and stop it once the resulting
state has stood for a few seconds (`O wait 3000`). `record start` keeps the open page. A clip
  holds less time than the wall clock: pauses without repaints are short in it. A scenario's second view on another page is a
scenario of its own. `V evidence check` reads clip lengths with `ffprobe`.

```bash
O record start "$E/grant.webm" --cursor
# … the action and its result …
O record stop
O screenshot "$E/granted.png"
printf 'action,expected,got\n"owner grants platform-inside","platform-inside,f","%s"\n' "$(
  V sql "select p.slug, a.revoked_at is not null from account_rights.product_access a
         join products.products p on p.id = a.product_id
         where a.account_id = '$(V account learner)'" | tail -1)" > "$E/access-rows.csv"

V evidence add --title "Владелец выдаёт продукт, ученик видит закрытый материал" \
  --kind video --file "grant.webm::выдача в карточке человека и открытый материал у ученика" \
  --shows "Карточка показывает «Доступ открыт», материал открылся" \
  --covers "features/product-access.md: access-grant, access-open" --result PASS
V evidence add --title "Выдача записана в базе" --kind table \
  --file "access-rows.csv::строка product_access после выдачи" \
  --shows "platform-inside, не отозван" --covers "access-grant" --result PASS
```

`--source` is `light-instance` by default. Each scenario carries its own result, and a result
other than `PASS` carries `--notes`. A file belongs to one scenario; files left out of the
manifest are not evidence. A recording belongs to one session; a scenario with two roles
records the role where the result appears, or adds a file per role.

Proof standards:

- **Real user path.** Reach the feature through the pages and controls a user has. Calling an API
  route, a setter or a test-only endpoint proves nothing about the feature. The synthetic sign-in
  address is the only shortcut: it stands where production has the external identity provider.
- **Action and result.** A clip or a pair of screenshots shows the action and the resulting state.
  A headless screenshot has no address bar: name the file after the role and state. Open at least
  one file per scenario and confirm it shows what the manifest says.
- **Side effects.** Next to what the page shows, read what the action wrote. `V sql` runs one
  reading statement in the light instance's database; each feature file names its rows. On the
  shared stand read side effects from the owner pages and the mail capture at
  `http://127.0.0.1:8025`.
- **Second view.** A mutation is proven from another view: another role's page, a reload, a list.
- **Substitutes** stand only where production already has an external boundary: the synthetic
  sign-in for the identity provider, the bank double for the bank, mail capture for SMTP. Whatever
  a light instance does not run (payments, mail, workers, notifications) is not exercised there.
- **Public repository.** Only what `.evidence/` holds reaches the PR, and only test data may be
  in it.

## 5. Verdict

```bash
V evidence verdict PASS+NOTES --notes "Список «Люди» не показывает имя из кабинета."
V evidence check      # exit 0 only when the manifest is complete
V report              # the verdict, commit, patch and scenarios, from the manifest
```

`evidence check` requires the manifest to be of the current commit, every file to fit its
scenario's kind, to exist and to be at most 10 MB, every clip to last at most 30 s, and the
verdict to agree with the scenarios and to carry notes unless it is `PASS`. Return the output of `V report` as the
result.

- **`PASS`**: every journey the change needs was driven, each observed end state and side effect
  matched, nothing else looked wrong.
- **`PASS+NOTES`**: the same, plus defects or deviations outside the change, in the notes.
- **`FAIL`**: any expected state or side effect was missing or wrong, the doctor could not be made
  to pass, or a journey the change needs could not be driven.

A scenario that could not be checked is added with kind `none`, the failing command in `--shows`
and the result `FAIL` when the change depends on it; otherwise name it in the notes as not
exercised. "Could not check" is never a pass. A journey driven through a different entry point
does not cover the skipped one. Report a failing journey as it is, and name a missing seed
precondition as the reason, so the map's owner can add it to the feature's Gotchas.

## 6. Cleanup

Stop what this run started, by the handle it was started with:

```bash
O close; H close; L close; N close; G close   # each role session this run opened
pnpm stand:light down           # this worktree's instance and its database
```

The helper runs page commands in its own sessions only: it refuses `kill-all`, `batch`,
`connect`, and options such as `--all`, `--session` or `--profile`. Stop a process only through the command that started it, and
leave the shared stand, its containers and other worktrees' instances running; release a stand
reservation this run took with `pnpm stand release --worktree "$PWD"`. Run cleanup after a failed
attempt too. Then confirm the evidence survived: `V evidence check` still passes.
`pnpm stand:light status` no longer has a line for this worktree; lines of other worktrees are
their instances and stay. `.evidence/` stays until its files are attached to the PR; it goes with
the worktree.

## Helpers

[`scripts/verify-platform.mjs`](../../../scripts/verify-platform.mjs) is executable and
`--help` lists its commands: `doctor`, `address`, `account`, `browser`, `sql`, `evidence start`, `path`,
`add`, `verdict`, `check` and `report`, each shown in the steps above. Its decisions live in
`scripts/verify-platform-plan.mjs`; `scripts/verify-platform*.test.mjs` test both.
