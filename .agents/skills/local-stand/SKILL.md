---
name: local-stand
description: Prepare or update the shared local application for an owner-requested task review, work interactively against it, inspect its owner, or release a completed review; or start a light per-agent instance of this worktree's web and API for a browser check. Use for local stand operations across worktrees; ordinary code edits and isolated tests do not reserve the stand.
---

# Shared local stand

Read the [stand runbook](../../../docs/runbooks/local-stand.md) before runtime operations.

For your own browser check of a change, without the owner's review, start a light instance:
`pnpm stand:light up` (add `--mcp` when the scenario needs MCP; `--dev` only when you edit Web
and need reload, at about twice the memory), sign in through the printed
sign-in address, and run `pnpm stand:light down` when the check ends. It needs no reservation and
runs beside other agents' instances. Use the shared stand below for an owner review, real Logto
sign-in, mail, payments, workers or production-web speed. The runbook's light instance section
lists the differences and the memory budget. To verify a change there as its user and return a
verdict with evidence, follow [verify-platform](../verify-platform/SKILL.md).
Use the stand controller from one checkout with installed dependencies. Pass the task's absolute
worktree path when invoking it from that controller checkout. Its status names the registered
controller; keep using that checkout while its stand state exists.

1. Inspect `pnpm --silent stand status --json`. It names the reserved worktree, its age and the
   queue. For `unmanaged`, preserve the runtime and obtain
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
     `agent-worktree finish` runs `pnpm stand:finish`: light instance down, own reservation released.
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

A mutation that finds the stand busy waits in a queue and prints its position; run it in the
background so a tool timeout does not end the wait. A reservation whose worktree was deleted is
released by the next mutation, which reports it.

Inspect command options with `pnpm stand --help`. Use `--production-web` for navigation-speed
checks; it retains the existing clean-source requirement. Run isolated tests and Storybook without
occupying the singleton. The controller governs cooperating local sessions; direct Docker commands
and old checkouts can bypass it, so route shared-stand mutations through the registered controller.
