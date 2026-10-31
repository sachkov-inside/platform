# Delivery

Rules for branches, worktrees, pull requests, blockers and handoff. `ship` owns merge and owner
participation; [ship](ship.md) adds the Platform facts.

## Branches and worktrees

Before an assignment, check remote branches and linked open PRs; reuse a matching branch.
Branch `<type>/<issue>-<slug>` from `origin/main`; a task without an Issue uses `<type>/<slug>`.
Types: `feat`, `fix`, `docs`, `chore`, `research`, `prototype`.

Use the environment-provided isolated worktree. A CLI session without one creates
`<parent>/<repo>.worktrees/<task>`; [REPOSITORIES.md](../../REPOSITORIES.md) owns the layout.
One writing context owns one worktree and stays in it.

The primary checkout belongs to the owner. Read it through `git -C` or absolute paths; change it
only on the owner's request. Keep other sessions' worktrees, branches, containers, volumes, stashes,
servers and results. Only `pnpm session:cleanup --apply` removes another session's resources, and
only when its rules prove them disposable.

## Pull requests

An independent task has one branch and one PR. A specification has one integration branch and one
final PR; worker branches stay until integration. Push the first commit and open a draft PR.
After the first push, integrate `origin/main` by merge, not by rebase or force-push.

## Blockers

A defect outside the task that blocks it gets a linked Issue labelled `ready-for-agent`; reuse an
open one. Fix the blocker first. The task's merge permission covers the fix only when one revert
undoes it and it touches only tests, CI, docs or scripts outside release and deploy. Otherwise ask.
`ship` still decides whether the owner must check the fix.
Work waiting for the owner stays open with the specific decision recorded.

## Handoff

State the result, the actual checks with exit codes, limits and the next action; link the PR.
A local preview update needs only its URL, scope and checks. When the task ends, run
`session-cleanup`. Keep an owner review server while the owner needs it, and record its port, PID,
working directory and how to stop it.
