---
name: session-cleanup
description: "Finish a task after its PR merges and clean up resources owned by the current task or session, or when the owner requests cleanup."
---

Report from the existing worktree before anyone removes it. The running session never removes
its own worktree. This project procedure overrides the machine's generic final-command recipe.

## 1. Inspect ownership

Read `agent-worktree status` and, if useful, the read-only `pnpm session:cleanup` plan. The latter
is a repository-wide inventory, not a task-scoped cleanup command. Its `--apply` can remove
another session's resources; it is not a fallback for an unprepared environment-created worktree.
Do not run it to finish this task, directly or through a project finish hook.

## 2. Stop this task's resources

Stop only services this task started, through their owning command (`pnpm stand:light down`,
a named browser session, `agent-worktree stop --name <name>`). Preserve a preview the owner still
needs and record its port, PID, cwd, source and stop/restart instructions. Containers and volumes
follow the [local stand runbook](../../../docs/runbooks/local-stand.md#stop-and-keep-data).

`agent-worktree finish` requires a task receipt from `prepare` and executes project finish hooks.
Before using it, inspect `.worktree-resources.json`: if a hook invokes repository-wide cleanup,
leave finish pending and report the tool gap. Do not create a new receipt merely to bypass
«no prepared task». Never pass `--remove-worktree` from the active session.

## 3. Report, then exit

Report PR and merged commit (or the pending gate), checks, stopped resources and each retained
resource with its owner and reason. Include the exact worktree path, branch and any task receipt.
Keep unpublished commits, changes, ignored files, evidence and stashes until their contents are
preserved or their owner explicitly disposes of them. Send `worker_done` when dispatched, or the
final response otherwise, then exit the writing session. An open PR retains its worktree.

## 4. Remove from outside

After the report, the coordinator or owner confirms the writing session and task processes have
exited, the PR merged, the worktree is clean and retained files/results have been preserved. They
remove this exact worktree through Orca from a different context. Follow the installed `orca-cli`
skill and inspect the selected worktree before removal; an idle chat alone does not prove exit.
A prepared task may instead finish from a separate cleanup context only if the tool supports
that target and its finish hooks are task-scoped. A missing receipt or missing external-target
support is a tool gap: report it, retain the worktree and use Orca after session exit.

## Done when

The final report names every retained resource and the coordinator or owner responsible for
later removal. Worktree deletion happens after this session finishes, not as its last command.
