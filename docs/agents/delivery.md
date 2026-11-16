# Delivery

Rules for branches, worktrees, pull requests, blockers and handoff. `ship` owns merge and the
owner-attention status ([ship](ship.md)); [human participation](human-review.md) owns the
rules of owner participation and evidence.

## Branches and worktrees

Before an assignment, check remote branches and linked open PRs; reuse a matching branch.
Branch `<type>/<issue>-<slug>` from `origin/main`; a task without an Issue uses `<type>/<slug>`.
Types: `feat`, `fix`, `docs`, `chore`, `research`, `prototype`.

The environment (Orca) creates the session's worktree in `~/Worktrees/<repo>/<task>`; work in it.
Claude Code's internal worktrees under `.claude/worktrees` are temporary; `agent-worktree sweep`
removes finished ones. Existing `<repo>.worktrees` checkouts of the earlier layout stay until
`session-cleanup` removes them. One writing context owns one worktree and stays in it.

The primary checkout belongs to the owner. Read it through `git -C` or absolute paths; change it
only on the owner's request. Keep other sessions' worktrees, branches, containers, volumes, stashes,
servers and results. Only `pnpm session:cleanup --apply`, and `agent-worktree sweep` for
`.claude/worktrees`, remove another session's resources, and only when their rules prove them
disposable.

## Pull requests

An independent task has one branch and one PR. A specification has one integration branch and one
final PR; worker branches stay until integration. Push the first commit and open a draft PR.
After the first push, integrate `origin/main` by merge, not by rebase or force-push.

## Blockers

A defect outside the task that blocks it gets a linked Issue labelled `ready-for-agent`; reuse an
open one. Fix the blocker first. The task's merge permission covers the fix only when one revert
undoes it and it touches only tests, CI, docs or scripts outside release and deploy. Otherwise ask.
`ship` still decides whether the owner must accept the fix.
Work waiting for the owner stays open with the specific decision recorded, asked under
[Ask the owner](human-review.md#ask-the-owner). When the blocking step
needs the owner's own hands (a credential, a provider dashboard, a cutover) and no existing script
covers it (such as
`pnpm --filter @inside/telegram credentialed-proof:wizard`), prepare it with `wizard`.

## Handoff

State the result, the actual checks with exit codes, limits and the next action; link the PR.
A local preview update needs only its URL, scope and checks. Keep an owner review server while
the owner needs it, and record its port, PID, working directory and how to stop it.

After the PR merges, the task's last step is the `agent-worktree finish` command of
[session-cleanup](../../.agents/skills/session-cleanup/SKILL.md).
