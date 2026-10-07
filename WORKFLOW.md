# Developer process

The process is the pipeline skills in `.agents/skills` (set and version in
`.agents/skills/PIPELINE.md`) plus this contract. The skills stay as `sync-pipeline` delivers them;
this contract and `AGENTS.md` hold what they leave open and the owner's overrides.

## Routes

- Work that fits one session: `issue → implement → review → pull request`. When the issue leaves an
  owner decision open, the owner grills it first (`grill-with-docs`).
- Work for several sessions: `grilling → to-spec → to-tickets`, then one `implement` session per
  ticket.

On either route, a visual change starts with a prototype (skill `prototype`).

The owner starts grilling, `to-spec` and `to-tickets`, each with its own command. Finish such a
stage with its outcome and the stage you recommend next, then wait. Every owner decision is made
there, and the look of an interface in a prototype, before tickets exist.

A task labelled `ready-for-agent` runs from `implement` to a ready pull request without stopping.
The owner starts it with `/implement #<issue>` in Claude Code or `$implement #<issue>` in Codex
CLI/IDE. When the skill is absent from the runtime catalog or the task arrives as plain text, read
`.agents/skills/implement/SKILL.md` and follow it. The acceptance criteria of the task name the
pre-agreed seams for `tdd`: write those seams down, then write the failing test first, without
asking. A criterion with no behaviour needs no test.

## Blockers and acceptance

- A defect outside the task that blocks it is a blocker. Take its open issue labelled
  `needs-triage` or `ready-for-agent`, or open one; label it `ready-for-agent`, link it to the task
  and fix it first. When the task body gives the agent the right to merge, one revert undoes the
  fix, and the fix changes only tests, CI jobs, documentation or scripts outside release and
  deploy, copy the merge line into the body of the blocker issue. Otherwise ask the owner whether
  the agent may merge.
- A task that waits for the owner's acceptance stays open with a comment naming what the owner
  accepts.

## Merge

The right to merge is a line in the task body; without it, the owner merges. A merge goes through
the [merge queue](docs/runbooks/continuous-integration.md#merge-queue).

## Is the task taken

A task is taken when the remote has its branch or a linked open pull request. Check both before
the first write:

```bash
git ls-remote --heads origin | grep -E "/[a-z]+/<issue>-"
gh pr list --state open --search "<issue> in:body"
```

Nothing protects the gap between the start and the first push. A Wayfinder ticket is taken by its
assignee instead (`docs/agents/issue-tracker.md`).

## Branch, worktree and pull request

- Branch `<type>/<issue>-<slug>` from the current `origin/main`, in its own worktree. Types:
  `feat`, `fix`, `docs`, `chore`, `research`, `prototype`. Trivial untracked work uses
  `<type>/<slug>`.
- Worktree place: `<parent>/<repo>.worktrees/<task>`, beside the repository checkout.
  `<task>` is the branch without its type prefix. The current Inside layout is in `REPOSITORIES.md`.
- The primary checkout belongs to the owner: read it. Only `session-cleanup` fast-forwards it after
  the merge, through `git -C`.
- One task has one branch, one writing worktree and one open pull request. Another session's
  worktree, branch, containers, volumes and stash entries are live state: leave them alone.
- One agent session works in one worktree: the one it starts in, or the one it creates for its
  task. Another worktree needs a new session; a subagent started in its own worktree is one.
- After the first commit, push and open a draft pull request with `Closes #<issue>`. When one task
  needs several pull requests, only the last one closes it; the others say `Part of #<issue>`.
- Once the branch is pushed, integrate `origin/main` by merge, without rebase or force-push.
- The pull request body is a result card in the owner's language with the sections `Что сделано`,
  `Что нужно от владельца`, `Проверка` (checked automatically, for the owner to check by hand, not
  checked), `Ревью` (findings with outcomes), `Риск merge` and `Что дальше`. The skill `pr` fills
  it: Summary goes into `Что сделано`, Evidence into `Проверка`, Merge Danger into `Риск merge`.

## Review

- Record the starting point (`git rev-parse origin/main`) before the first change.
- Commit, then run `code-review` from that starting point: it reviews `git diff <start>...HEAD`, so
  it cannot see an uncommitted change. When the runtime cannot start its sub-agents, run the review
  as a separate process with the same input: the diff, the task and the coding standards.
- Every finding gets one outcome: fixed, moved to a linked issue, or rejected with evidence.
- After the fixes, run one more review pass, then close what remains with outcomes.

## Done

Done means the check under `Commands` in `AGENTS.md` is green on the final head with its real exit
code. The agent then:

1. marks the acceptance criteria in the task;
2. brings the pull request to green CI on the current head. A failed check is diagnosed and fixed.
   Re-run a failure that diagnosis attributes to the CI provider. When the diff changes neither the
   failed test or job nor code that the failed test runs, re-run it once without further diagnosis
   and make sure an open issue tracks the failure: find it or open one with `needs-triage`. The
   re-run unblocks the pull request; the issue fixes the cause. A failure after that re-run is
   diagnosed; when it blocks the task, it is a blocker;
3. reads `closingIssuesReferences` of the pull request and compares it with the task number:
   `gh pr view <pr> --json closingIssuesReferences --jq '.closingIssuesReferences[].number'`;
4. runs `session-cleanup`;
5. hands off in chat: the pull request link, one line of outcome, the checks that ran and those
   that did not, and each leftover the cleanup kept.

Steps 4 and 5 apply to any hand-off to the owner: a ready pull request, a stopped task or a result
that waits for acceptance.

## Owner corrections

The owner turns a correction into an automatic check or a `CODING_STANDARDS.md` rule with `retro`.

## Owner gates

Explicit owner approval is required for:

- releases and deployments;
- publishing;
- paid actions;
- credentials;
- external messages;
- a merge, unless the task body gives that right to the agent.

An approval covers the scope the owner stated and lasts until the owner withdraws it. Inside that
scope, act without asking again; a restart of a stand that the agent started at the owner's
request is one such case. Waiting for an answer is never consent.
