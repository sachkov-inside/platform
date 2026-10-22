# Coordinated execution

Use this contract for a session launch, an assigned coordination of sessions or workers, or the
execution of a whole specification through `implement-spec`. `WORKFLOW.md` owns assignments,
branches, review, classification and owner gates; this document adds only what coordination needs.

## Runtimes

Native workers run in the current runtime and inherit the current agent and model unless the owner
selects otherwise. Herdr and Orca are equal options for separately assigned owner or project
sessions; use the one the owner's assignment or environment names. An independent session never
substitutes for a required native worker, and native pipeline workers remain internal to their task.

## Session launch

An ordinary session launch hands off an independent owner or project session: deliver the
assignment, verify receipt, and report its location. That completes the launch, including any
startup recovery. Launching specification work elsewhere assigns execution to the destination
session only.

Ongoing prompts, answering questions, accepting results, and closing sessions require assigned
coordination. Record the assigned tasks or sessions, the lead, and responsibilities in the issue and
handoff. A monitor-only assignment authorizes observation and reporting.

## Whole-specification execution

Follow the installed `implement-spec` body with these project overrides:

- Coordinate only the assigned specification or tickets and the coordinator's own workers and
  resources. Discussing or preparing a specification keeps the requested scope.
- Use native implementer and merger workers. Each implementer owns an isolated writing worktree
  based on the integration branch; native subagents perform independent review.
- Serialize shared runtime and Compose operations under the
  [singleton ownership rule](../runbooks/local-stand.md#parallel-worktrees-and-singleton-ownership).
- Every implementation ticket receives independent review before acceptance into the integration
  branch. The final integrated specification receives a separate independent review and the
  mandatory checks before delivery.

## Task map and resumption

Keep the task map in issues and PRs: dependencies, decisions, session IDs, resource owners, commits,
checks, and next actions. On resumption, reconcile the actual state and assign only the remaining
assigned work. Keep active workers and recovered results. Resume owner-paused work only on the
owner's request.
