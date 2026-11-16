# Implementation

Root [AGENTS.md](../../AGENTS.md#process) owns what starts work. Keep the worktree mode and
ownership in [delivery](delivery.md).

## Acceptance and tests

Without a ticket, state the agreed result and acceptance criteria before writing. That list is
the specification for review. Record starting HEAD and the immutable base covering the whole task.
Use TDD where possible; [testing](testing.md) owns the test kinds, the seams and who chooses them.
For a bug or regression whose cause is unknown, find the cause with `diagnosing-bugs` before the fix.
During product implementation, run typechecking and focused test files regularly. Finish with the
verification in root AGENTS.md → Commands.

## Review and delivery

Commit assigned work before `code-review`. Supply immutable base/head and the requirement source
for independent Standards and Spec review over the complete assigned diff. Fix confirmed
findings, rerun affected checks, commit and re-review with the earlier reports, preserving original
full-diff coverage. List unresolved judgement calls. Then use `ship` and the target branch's
[ship contract](ship.md), not proposed gate changes on the task branch.
