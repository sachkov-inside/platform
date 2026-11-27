---
name: verify-platform
description: Verify a change in the running Platform web application as its user and return a PASS, PASS+NOTES or FAIL verdict with video, screenshots and observed side effects. Use when asked to verify a change in the real application.
---

# Verify Platform

You verify a change you did not write, in the running application, as its user. The output is a
**verdict** with **evidence** the owner can open. The steps run in this order; the helper is
`node scripts/verify-platform.mjs` (`--help` lists its commands), run from the worktree root.

**The task says what to verify.** Take the scenarios from the task and its key scenarios: what
the owner asked to see and the acceptance criteria. Find where each one lives in the application
from the code: the routes under `apps/web/app`, the texts and controls in `apps/web/src`, the seed
in `apps/backend/src/development` and the light-instance roles in `scripts/stand-light-plan.mjs`. When the task does not say what counts as success for a
scenario, return that as a note in the verdict; never invent a scenario to have something to
pass. [Roles and gotchas](roles-and-gotchas.md) holds what the code does not tell: who to sign in
as, what a light instance cannot do, and where the browser tool misleads. Read it before driving.

## 1. Launch

A **light instance** is this worktree's web and API on free loopback ports with its own freshly
seeded database. It needs no shared stand reservation.

```bash
pnpm verify:light -- bash  # prints the addresses and opens the admitted shell
```

Commit first: web is built once at `up`, so a later commit, checkout or edit of a web build input
(`apps/web`, `packages`, dependencies) needs a new verification session. Run the following commands inside that shell. Exit it to close
the browsers and the light instance. The command requires the shared PostgreSQL and object
storage to be running.

The instance is usable when the doctor passes, not when `up` returns.

Use the **shared stand** instead only when the scenario needs a capability listed under
[what a light instance does not run](roles-and-gotchas.md#what-a-light-instance-does-not-run).
It is one per machine and holds the owner's data. Follow the
[local-stand skill](../local-stand/SKILL.md): read `pnpm --silent stand status --json`, then run
`pnpm stand show --worktree "$PWD"` in the background, because a busy stand queues the command and
a tool timeout gives up the place. A foreign reservation stays; replacing it needs the owner's
request, so report the scenario as not exercised. Drive the stand only when its status is `ready`
and its `Source` equals `git rev-parse HEAD`; the doctor below covers light instances only. The
stand keeps what a scenario writes: a scenario that leaves permanent data there, such as a
purchase, needs the owner's request for this verification.

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
O set viewport 1440 900
O snapshot -i -s main
O find role button click --name "Выдать продукт"
O wait --text "Доступ выдан."
```

- **Roles.** `owner`, `holder`, `learner`, `newcomer` and `guest`, one session each;
  [roles and gotchas](roles-and-gotchas.md) says who each one is, which scenario it suits and how
  it signs in, on a light instance and on the shared stand.
- **Namespace.** Set `AGENT_BROWSER_NAMESPACE` before starting the admitted shell.
  The same namespace identifies each role for automatic cleanup.
- **Handles.** Act on roles and accessible names (`find role … --name`, `find label …`), or on a
  ref from a fresh `snapshot -i`; take the names from the code and the snapshot. Coordinates are
  never a handle.
- **Waits.** After each action wait for the text or URL the scenario names (`wait --text`,
  `wait --url`), then snapshot.
- **Viewport.** Set 1440×900 after a session's first `open`.

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
| `video` | the proof is motion: an order of actions, a transition | one clip, 10–30 s as the aim, 30 s at most |
| `screenshot` | the proof is how a page looks at one moment | one; two (before, after) when an existing view changes |
| `table` | the proof is not on screen: rows written, a request and its answer | a CSV or Markdown table «action, expected, got» from the running server; the PR shows it as text |
| `numbers` | the proof is speed | a CSV or Markdown table «measure, before, after»; the PR shows it as text |
| `none` | no file may be kept, or nothing can be shown | none; the result in words |

A `numbers` scenario measures at least five runs of each side, before and after alternating, and
reports the median with the count of runs and their range as extra columns. It also proves that
the change took effect: a fact that differs between the two sides, such as a version or a flag.

GitHub attaches at most 10 MB per file, so record one short clip per scenario, never the whole
run in one file: start the recording right before the action and stop it once the resulting
state has stood for a few seconds (`O wait 3000`). `record start` keeps the open page. A
scenario's second view on another page is a scenario of its own. `V evidence check` reads clip lengths with `ffprobe`.

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
  --covers "#2211: владелец выдаёт продукт, ученик читает закрытый материал" --result PASS
V evidence add --title "Выдача записана в базе" --kind table \
  --file "access-rows.csv::строка product_access после выдачи" \
  --shows "platform-inside, не отозван" --covers "#2211: выдача записана" --result PASS
```

`--covers` names the task and its scenario. `--source` is `light-instance` by default. Each scenario carries its own result, and a result
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
  reading statement in the light instance's database; find the tables in the backend's code. On the
  shared stand read side effects from the owner pages and the mail capture at
  `http://127.0.0.1:8025`.
- **Second view.** A mutation is proven from another view: another role's page, a reload, a list.
- **Substitutes** stand only where production already has an external boundary: the synthetic
  sign-in for the identity provider, the bank double for the bank, mail capture for SMTP. Capabilities
  [absent from a light instance](roles-and-gotchas.md#what-a-light-instance-does-not-run) are not exercised there.
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

- **`PASS`**: every scenario of the task was driven, each observed end state and side effect
  matched, nothing else looked wrong.
- **`PASS+NOTES`**: observed results match the change, with notes about unrelated defects or
  coverage unavailable solely because of a stand/light-instance limit outside scenarios the
  plan asked to show. Mark that coverage «Не проверено»; this verdict does not claim it passed.
  An unrelated defect gets a linked Issue. A scenario whose success the task leaves undefined
  also goes into the notes, with the missing criterion explicitly stated.
- **`FAIL`**: an observed expected state or side effect inside the change is missing or wrong,
  even if cosmetic or easy to fix. The verifier describes the deviation without accepting it
  on the owner's behalf. Also fail when a scenario cannot run for a reason other than a stand
  limit, or a stand limit blocks a scenario the plan explicitly asked to show.

The stand-limit exception above takes precedence over missing coverage, including a failed doctor
or an implementation-derived scenario the plan did not ask to show. Record the exact command and
output and «Не проверено» in notes, with kind `none`; use `PASS+NOTES` for that scenario and the
verdict unless another failure requires `FAIL`. This alone does not call the owner. A skipped
entry point is not covered by driving another one. A missing seed precondition is a stand limit;
a working stand that exposes wrong behaviour in the change is a failure, never a stand limit.

A scenario whose success the task leaves undefined goes into the manifest with kind `none`,
result `PASS+NOTES`, what was observed in `--shows` and a question for the task's author in
`--notes`. This records the missing criterion, not a passed check.

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
