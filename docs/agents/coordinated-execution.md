# Coordinated execution

Use this for a session launch, an assigned coordination of sessions, or `implement-spec`.

## Sessions

Native workers run in the current runtime with the current agent and model unless the owner chooses
otherwise. Herdr and Orca are equal options for a separate owner or project session; use the one the
assignment or environment names. An independent session never replaces a native worker.

A session launch delivers the assignment, verifies receipt and reports the session's location; that
completes it. Launching specification work elsewhere assigns execution to that session only.
Ongoing prompts, answers, accepting results and closing sessions need an assigned coordination;
record the sessions, the lead and their duties in the Issue. A monitor-only assignment permits
observation and reports.

## Whole specification

- Coordinate only the assigned specification or tickets and your own workers and resources.
- Each implementer works in its own worktree based on the integration branch.
- Serialize shared runtime and Compose operations under the
  [singleton ownership rule](../runbooks/local-stand.md#parallel-worktrees-and-singleton-ownership).
- Keep exploration notes in the coordinator's worktree under the ignored `.reports/<specification>/`.
- Keep the task map in Issues and PRs: dependencies, decisions, sessions, resource owners and next
  actions. On resumption, reconcile the actual state and assign only the remaining work. Resume work
  the owner paused only on the owner's request.
