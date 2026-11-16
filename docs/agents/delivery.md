# Delivery

Rules for branches, worktrees, pull requests, blockers and handoff. `ship` owns merge and the
owner-attention status ([ship](ship.md)); [human participation](human-review.md) owns the
rules of owner participation and evidence.

## Branches and worktrees

Before an assignment, check remote branches and linked open PRs; reuse a matching branch.
Branch `<type>/<issue>-<slug>` from `origin/main`; a task without an Issue uses `<type>/<slug>`.
Types: `feat`, `fix`, `docs`, `chore`, `research`, `prototype`.

In the clean environment-created worktree, create the project-named branch without tracking
`origin/main` (replace the example name consistently):

```sh
git fetch origin
git switch --no-track -c docs/pilot-fixes origin/main
git config --local branch.docs/pilot-fixes.pushRemote origin
# After committing:
git push --set-upstream origin HEAD:refs/heads/docs/pilot-fixes
```

The explicit destination also works when `push.default=upstream`. Check `git branch -vv` before
pushing: before the first push this branch has no upstream; afterwards it tracks its own remote
branch. Reuse an existing matching task branch instead of creating it again. Preserve any work
already on the environment branch before switching; a dirty worktree or unpublished task commits
are not permission to reset them.

The environment (Orca) creates the session's worktree in `~/Worktrees/<repo>/<task>`; work in it.
Claude Code's internal worktrees under `.claude/worktrees` are temporary; `agent-worktree sweep`
removes finished ones. Existing `<repo>.worktrees` checkouts of the earlier layout stay until
`session-cleanup` removes them. One writing context owns one worktree and stays in it.

The primary checkout belongs to the owner. Read it through `git -C` or absolute paths; change it
only on the owner's request. Keep other sessions' worktrees, branches, containers, volumes, stashes,
servers and results. The coordinator or owner may remove this task's exact worktree through
Orca after its writing session exits and the [cleanup checks](../../.agents/skills/session-cleanup/SKILL.md)
prove it disposable. Repository-wide `pnpm session:cleanup --apply` and `agent-worktree sweep`
for `.claude/worktrees` belong to separately assigned cleanup, not routine task completion.

## Pull requests

An independent task has one branch and one PR. A specification has one integration branch and one
final PR; worker branches stay until integration. Push the first commit and open a draft PR.
After the first push, integrate `origin/main` by merge, not by rebase or force-push.

## Blockers

A defect outside the task that blocks it gets a linked Issue labelled `ready-for-agent`; reuse an
open one. Fix the blocker first, in its own PR with its own
[owner-attention status](ship.md#owner-attention).
Work waiting for the owner stays open with the specific decision recorded, asked under
[Ask the owner](human-review.md#ask-the-owner). When the blocking step
needs the owner's own hands (a credential, a provider dashboard, a cutover) and no existing script
covers it (such as
`pnpm --filter @inside/telegram credentialed-proof:wizard`), prepare it with `wizard`.

## Handoff

State the result, the actual checks with exit codes, limits and the next action; link the PR.
A local preview update needs only its URL, scope and checks. Keep an owner review server while
the owner needs it, and record its port, PID, working directory and how to stop it.

After merge, stop only this task's resources and report the result while the worktree still
exists. The session never removes its own running worktree. After its final report and session
exit, the coordinator or owner removes the worktree through Orca, with ownership and preservation
checks from [session-cleanup](../../.agents/skills/session-cleanup/SKILL.md).
