---
name: session-cleanup
description: "Clean up resources owned by the current task or session before handoff, or when the owner requests cleanup."
---

Cleanup is the writing agent's last step. `pnpm session:cleanup` decides ownership by rules, not by
memory: its plan gives an action and a reason for each worktree and for each process or temporary
entry it acts on. The rules live in the header of [the script](../../../scripts/session-cleanup.mjs);
a resource they cannot prove disposable is kept and reported.

## 1. Read the plan

Run `pnpm session:cleanup` from the task worktree. It changes nothing. Read every `remove`, `prune`
and `stop` line, and every `keep` reason for this task's worktree and processes.

## 2. Protect what the owner still needs

Record an owner review server's port, PID, cwd, source and stop/restart instructions in the handoff.
The script stops a process only when its worktree is removed or its directory no longer exists.
If the plan stops a server the owner still needs, skip step 3 and name that server in the handoff.

## 3. Apply

Run `pnpm session:cleanup --apply`. It rechecks each worktree before removal and keeps one that
changed. A non-zero exit lists the failures; record each one in the handoff.

## 4. Resolve what the rules keep

- The current worktree stays: a later run removes it after its PR merges.
- Unpublished commits, local changes and ignored local files (`.env*`, `.reports/`) stay; record
  the exact remaining action.
- Stashes stay. Inspect a safety stash this task created against the merged result before dropping it.
- Containers and volumes follow [the local stand runbook](../../../docs/runbooks/local-stand.md#stop-and-keep-data);
  the script only reports them.
- Resources outside the script's rules, such as a task-owned Compose project, go through their owners.

## Done when

A fresh `pnpm session:cleanup` lists no `remove`, `prune` or `stop` line, or the handoff names each
remaining one with its owner and reason.
