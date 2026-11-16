---
name: session-cleanup
description: "Finish a task after its PR merges and clean up resources owned by the current task or session, or when the owner requests cleanup."
---

After the PR merges, the task's last step runs from the task worktree:

```sh
agent-worktree finish --task <task> --apply --remove-worktree
```

It runs the project steps in `.worktree-resources.json`, stops the task's processes, previews
included, and removes the worktree only when nothing failed or stayed. Before the merge, or when
`agent-worktree` is not installed or has no prepared task here, `pnpm session:cleanup --apply` is
the last step instead.

`pnpm session:cleanup` decides ownership by rules, not by memory: its plan gives an action and a
reason for each worktree and for each process or temporary entry it acts on. The rules live in the
header of [the script](../../../scripts/session-cleanup.mjs); a resource they cannot prove
disposable is kept and reported.

## 1. Read the plan

Run `pnpm session:cleanup` from the task worktree. It changes nothing. Read every `remove`, `prune`
and `stop` line, and every `keep` reason for this task's worktree and processes. A warning means the
plan kept resources it could not check; start the named tool, such as Docker, and run it again.

## 2. Protect what the owner still needs

Record an owner review server's port, PID, cwd, source and stop/restart instructions in the handoff.
If the owner still needs a server of this task, skip step 3 and name that server in the handoff.

## 3. Finish

Run the last step above. A failed step or a kept resource leaves the worktree in place; record each
one from its report in the handoff.

## 4. Resolve what the rules keep

- Unpublished commits, local changes and ignored local files stay; record the exact remaining action.
- Stashes stay. Inspect a safety stash this task created against the merged result before dropping it.
- Containers and volumes follow [the local stand runbook](../../../docs/runbooks/local-stand.md#stop-and-keep-data);
  the script only reports them.
- Resources outside the script's rules, such as a task-owned Compose project, go through their owners.

## Done when

The last step's report shows the worktree removed, or the handoff names each failed step, kept resource
and remaining worktree with its owner and reason.
