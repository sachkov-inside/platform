---
name: session-cleanup
description: "Clean up resources owned by the current task or session before handoff, or when the owner requests cleanup."
---

Cleanup is the writing agent's last step. Preserve other sessions and resources.
Use the task and PR resource records to identify what this session acquired or explicitly inherited.
A resource with changed ownership belongs to its new owner.

## 1. Inspect owned resources

Check the current worktree's status and branch. Inspect only recorded worktrees, branches,
containers, volumes, processes, temporary files and safety stashes owned by this task.
Use a process's PID and working directory, or a container's Compose labels, to confirm ownership.
When ownership is uncertain, preserve the resource and record that uncertainty in the handoff.
If the session acquired no disposable resources, record that fact; no machine-wide inventory is needed.
Before any repository Compose command, follow the singleton ownership rule in
[local development](../../../docs/runbooks/local-stand.md#parallel-worktrees-and-singleton-ownership).

## 2. Release disposable resources

Stop and remove the owned containers, volumes and processes. Delete owned temporary files.
Preserve a preview while the owner needs it. Record its port, PID, cwd, source, and stop/restart
instructions before closing its pane or handing ownership to another session.

## 3. Resolve task-local state

While a PR is open, keep its writing worktree and branch.
After merge or closure, remove an owned task worktree and branch only when its changes are clean
and every commit is preserved by a remote branch or merged PR. A squash-merged PR preserves its
commits even when they are not ancestors of `main`.
Inspect owned safety stashes against the merged result before dropping them.
Keep unpublished work and record the exact remaining action.
The primary checkout and unrelated local branches remain with their owners; update them only
when the assignment includes that action.

## Done when

Every disposable resource owned by this task is released, or the handoff names its owner and why
it remains. Other sessions' worktrees, branches, stashes, containers, volumes and processes are preserved.
