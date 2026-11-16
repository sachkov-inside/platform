---
name: verify-platform
description: Verify a change in the running Platform web application the way a user would. Launch this worktree's light instance, drive it with agent-browser, record video, screenshots and side effects, and return a PASS, PASS+NOTES or FAIL verdict. Use when asked to verify, prove or show a change working in the real application.
---

# Verify Platform

You verify a change you did not write, in the running application, as its user. The output is a
**verdict** with **evidence** the owner can open. The steps run in this order; the helper is
`node scripts/verify-platform.mjs` (`--help` lists its commands), run from the worktree root.

Pick the journeys from the [feature map](features/README.md): the features the change touches,
and each entry point the map lists for them. An entry point the map marks as not yet driven has no
recipe: drive it from fresh snapshots and add its steps to the map, or report it as not exercised.

## 1. Launch

A **light instance** is this worktree's web and API on free loopback ports with its own freshly
seeded database. It needs no reservation and runs beside other worktrees' instances.

```bash
pnpm stand:light up        # 10–20 s; prints the addresses
```

Commit or finish editing first: web is built once at `up`, so a later change to `apps/web`,
`packages` or dependencies needs `pnpm stand:light down` and `up`. Start one instance at a time on
the machine (2.9 GiB while it builds). `up` refuses when the shared stand's PostgreSQL and object
storage are not running; it never starts containers, so report that as a blocker.

The instance is usable when the doctor passes, not when `up` returns.

Use the **shared stand** instead only when the journey needs what a light instance lacks: real
Logto sign-in, mail codes, the bank double, background workers, notifications or the owner's data.
It is one per machine and holds the owner's data. Follow the
[local-stand skill](../local-stand/SKILL.md): read `pnpm --silent stand status --json`, then run
`pnpm stand show --worktree "$PWD"` in the background, because a busy stand queues the command and
a tool timeout gives up the place. A foreign reservation stays; replacing it needs the owner's
request, so report the journey as not exercised. Drive the stand only when its status is `ready`
and its `Source` equals `git rev-parse HEAD`. Roles there are chosen at
`http://127.0.0.1:3000/__local/accounts` (radios «Владелец», «Ученик с доступом»,
«Ученик без доступа», «Гость», button «Выбрать аккаунт»).

## 2. Doctor

```bash
node scripts/verify-platform.mjs doctor      # exit 0 only when every check passes
```

Read-only. It checks that the supervisor is alive and `ready`, that web was built after the last
change that reaches the build, that the web and API ports are held by this instance's own
processes, that the API reaches its database and the home feed serves seeded materials, and that
the owner signs in with authoring rights and the learner without. Run it before the first drive
and again whenever a page looks wrong. A failed check names its fix; drive nothing until all pass.

## 3. Drive

Every browser command goes through the helper. It runs `agent-browser` in this worktree's own
headless session for the role, and adds the launch settings a loopback page needs on this machine.

```bash
V() { node scripts/verify-platform.mjs "$@"; }     # define these in every shell command
O() { V browser --role owner -- "$@"; }
L() { V browser --role learner -- "$@"; }
G() { V browser --role guest -- "$@"; }

O open "$(V address owner /authoring/people)"      # sign in as owner and open the page
O set viewport 1440 900                            # once per session, after its first open
O snapshot -i -s main
O find role button click --name "Выдать продукт"
O wait --text "Доступ выдан."
```

- **Roles.** `owner` has `platform:admin` and opens `/authoring`; `learner` is an account with no
  products; `guest` never signs in (`V address web /path`). Each role is its own session with its
  own cookies, so they stay signed in side by side. `V address sign-out /` ends a session's
  sign-in.
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
- **First visit.** The learner's first open of `/account` shows «Добро пожаловать» in place of
  the cabinet; press «Принять условия и продолжить», then open the address again. Public pages,
  materials and `/bookmarks` do not ask. Dismiss the cookie notice with «Понятно» once per
  session: it covers controls near the bottom of the page.
- **Output.** `agent-browser` prints a notice that its Chrome is behind the stable release on
  each launch; it does not affect the run.
- **Routes.** Reader: `/`, `/materials/<slug>`, `/products/<slug>`, `/products/<slug>/buy`,
  `/bookmarks`, `/account`. Owner: `/authoring`, `/authoring/materials`, `/authoring/products`,
  `/authoring/people`, `/authoring/sales/payments`. The feature files carry the rest.

If `agent-browser` cannot do a step, report the exact failing command; do not switch tools.

## 4. Evidence

```bash
E="$(V evidence start)"   # once per run; prints the directory
E="$(V evidence path)"    # the same directory, in every later shell command
```

The directory lives under the repository's shared Git directory
(`<git-common-dir>/inside-platform-stand/verify/<time>-<branch>-<commit>/`), outside every
worktree, with `run.json` naming the commit and patch. Proof standards:

- **Real user path.** Reach the feature through the pages and controls a user has. Calling an API
  route, a setter or a test-only endpoint proves nothing about the feature. The synthetic sign-in
  address is the only shortcut: it stands where production has the external identity provider.
- **Action and result.** Record a video of each journey and take a screenshot before the action
  and of the resulting state, with the page identity visible.

  ```bash
  O record start "$E/owner-grant.webm" --cursor
  O screenshot "$E/01-owner-before.png"
  # … the journey …
  O screenshot "$E/02-owner-granted.png"
  O record stop
  ```

  A recording belongs to one session; a journey with two roles records each role's part. Open
  at least one screenshot per journey and confirm it shows the claimed state.
- **Side effects.** Next to what the page shows, read what the action wrote, and save it:

  ```bash
  V sql "select product_id, revoked_at, revision from account_rights.product_access" \
    | tee "$E/03-product-access.csv"
  ```

  `sql` runs one reading statement in the light instance's database. Each feature file names its
  rows. On the shared stand read side effects from the owner pages and the mail capture at
  `http://127.0.0.1:8025`.
- **Second view.** A mutation is proven from another view: another role's page, a reload, a list.
- **Substitutes** stand only where production already has an external boundary: the synthetic
  sign-in for the identity provider, the bank double for the bank, mail capture for SMTP. Whatever
  a light instance does not run (payments, mail, workers, notifications) is not exercised there.
- **Public repository.** A light instance holds only seed data, and only that may reach a PR or
  an Issue. Evidence from the shared stand stays on the machine: it can show the owner's accounts,
  purchases and unpublished materials.

## 5. Verdict

`V report` prints the skeleton with the commit, the patch and every
artifact with its size and digest. Fill it and return it as the result.

- **`PASS`**: every journey the change needs was driven, each observed end state and side effect
  matched, nothing else looked wrong.
- **`PASS+NOTES`**: the same, plus defects or deviations outside the change, listed.
- **`FAIL`**: any expected state or side effect was missing or wrong, the doctor could not be made
  to pass, or a journey the change needs could not be driven.

State what was exercised (feature file, sub-feature IDs, entry points), what was not and why, and
each side effect with the rows it returned. "Could not check" is never a pass: an unreachable
journey is reported under not exercised with the failing command, and fails the verdict when the
change depends on it. A journey driven through a different entry point does not cover the skipped
one. Report a failing journey as it is; a missing seed precondition goes to the feature's Gotchas.

## 6. Cleanup

Stop what this run started, by the handle it was started with:

```bash
O close; L close; G close       # each role session this run opened
pnpm stand:light down           # this worktree's instance and its database
```

The helper refuses `close --all`, `kill-all` and other sessions. Never stop a process by name, and
leave the shared stand, its containers and other worktrees' instances running; release a stand
reservation this run took with `pnpm stand release --worktree "$PWD"`. Run cleanup after a failed
attempt too. Then confirm the evidence survived: `ls "$(V evidence path)"` lists the artifacts.
`pnpm stand:light status` no longer has a line for this worktree; lines of other worktrees are
their instances and stay.

## Helpers

[`scripts/verify-platform.mjs`](../../../scripts/verify-platform.mjs) is executable; its decisions
live in `scripts/verify-platform-plan.mjs`, and `scripts/verify-platform*.test.mjs` test both.

| Command | Result |
|---|---|
| `doctor [--json]` | The checks of step 2 |
| `address <owner\|learner\|sign-out\|web\|api> [path]` | An address of this worktree's instance |
| `browser [--role owner\|learner\|guest] -- <agent-browser command>` | That command in the role's own session |
| `sql "<select …>"` | CSV of one reading statement from the instance's database |
| `evidence start [--label TEXT]`, `evidence path` | The run's evidence directory |
| `report` | The verdict skeleton with the artifact table |
