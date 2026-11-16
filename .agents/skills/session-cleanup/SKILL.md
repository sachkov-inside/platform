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

Platform's finish adapter runs only `pnpm stand:finish`. It preserves the light-instance and
shared-stand ownership checks; a failure returns nonzero and keeps worktree removal pending.
Use the standalone owning commands above while this writing session is still active.

## 3. Report, then exit

Report PR and merged commit (or the pending gate), checks, stopped resources and each retained
resource with its owner and reason. Include the exact worktree path, branch and any task receipt.
Keep unpublished commits, changes, ignored files, evidence and stashes until their contents are
preserved or their owner explicitly disposes of them. Send `worker_done` when dispatched, or the
final response otherwise, then exit the writing session. An open PR retains its worktree.

## 4. Remove from outside

After the report, the coordinator or owner confirms writer exit, merged exact HEAD and captured
retained files. From a different context, use the canonical Home `agent-worktree finish` with
explicit task, worktree, repository and fresh completion evidence. For an environment-created
Orca worktree without `prepare`, first use its explicit identity-only `adopt` operation. Follow
Home `machine/docs/cleanup.md` for the receipt contract and supported native route; do not copy
or invent ownership records. Start with dry-run and inspect every retained reason before apply.

Unknown liveness, missing provenance, ignored evidence and retained resources keep the worktree.
Report the reason to the coordinator; there is no repository-wide cleanup fallback. Removal uses
the exact validated Orca identity after session exit. This session remains in its retained worktree.

## Done when

The final report names every retained resource and the coordinator or owner responsible for
later removal. Worktree deletion happens after this session finishes, not as its last command.
