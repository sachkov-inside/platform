---
name: local-stand
description: Prepare or update the shared local application for an owner-requested task review, work interactively against it, inspect its owner, or release a completed review. Use for local stand operations across worktrees; ordinary code edits and isolated tests do not reserve the stand.
---

# Shared local stand

Read the [stand runbook](../../../docs/runbooks/local-stand.md) before runtime operations.
Use the stand controller from one checkout with installed dependencies. Pass the task's absolute
worktree path when invoking it from that controller checkout. Its status names the registered
controller; keep using that checkout while its stand state exists.

1. Inspect `pnpm --silent stand status --json`. For `unmanaged`, preserve the runtime and obtain
   its owner's handoff. For `stopped`, continue using the reported reservation; an empty first
   startup needs no handoff.
2. Map the owner's request:
   - Show a task, including a review postponed until later: `pnpm stand show --worktree <task>`.
     This reserves a source snapshot and leaves it running after this session ends.
   - Edit Web and watch changes in the application: add `--live`. Web app/src/public are mounted
     read-only into the development server. Backend, dependencies and configuration need `refresh`.
   - Update the selected task: `pnpm stand refresh --worktree <task>`. It retains the preview mode.
   - Finish interactive work and leave it for later review: use `show` without `--live` to freeze
     the current source. The snapshot freezes code, not database contents.
   - Finish a review and make the stand available: `pnpm stand release --worktree <task>`.
     Release keeps the application and its data running.
3. A foreign reservation stays in place. An explicit owner request to show a different task permits
   `show --replace <current-reservation-id> --worktree <new-task>`. This ID detects concurrent
   replacement; it is not a secret or an independent grant of permission. If it changed, reassess
   the latest request instead of retrying with successive IDs. An implementation assignment alone
   does not authorize replacing another review.
4. Return the URL only after `ready`. State the task, preview mode, source revision and reservation.
   Preserve the reservation through delays, session completion and cleanup until the owner releases
   it or requests another task. For `recovery`, keep the state and use `refresh` on the reserved task
   after the failed operation has ended; after a failed upgrade, rerun the same `upgrade`. For a
   newer schema or infrastructure on an owner request, run `pnpm stand upgrade --worktree <task>`.
   Apply the runbook's handoff procedure for
   changed identity or an unmanaged runtime.

Inspect command options with `pnpm stand --help`. Use `--production-web` for navigation-speed
checks; it retains the existing clean-source requirement. Run isolated tests and Storybook without
occupying the singleton. The controller governs cooperating local sessions; direct Docker commands
and old checkouts can bypass it, so route shared-stand mutations through the registered controller.
