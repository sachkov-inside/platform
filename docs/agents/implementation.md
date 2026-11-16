# Implementation

Root [AGENTS.md](../../AGENTS.md#process) owns what starts work. Keep the worktree mode and
ownership in [delivery](delivery.md).

## Acceptance and tests

Without a ticket, state the agreed result, acceptance criteria and the
[key scenarios](human-review.md#agree-in-the-specification) before writing. That list is the
specification for review. Record starting HEAD and the immutable base covering the whole task.
Use TDD where possible at pre-agreed seams. Respect owner-agreed seams and critical behaviours;
write down the seams under test. Choose remaining seams from acceptance criteria and public
interfaces. Ask the owner when intended behaviour or an agreed boundary is unclear; routine test
selection belongs to the implementer. Give each proposed seam one line on what it catches and misses.
For a bug or regression whose cause is unknown, find the cause with `diagnosing-bugs` before the fix.
During product implementation, run typechecking and focused test files regularly. Finish with the
verification in root AGENTS.md → Commands.

## Review, verification and delivery

Commit assigned work before `code-review`. Supply immutable base/head and the requirement source
for independent Standards and Spec review over the complete assigned diff. Fix confirmed
findings, rerun affected checks, commit and re-review with the earlier reports, preserving original
full-diff coverage. List unresolved judgement calls. Next comes
[verification](human-review.md#verification) by a fresh agent, or one line on why the change needs
none. Then use `pr` and `ship` under the target branch's [ship contract](ship.md), not proposed
gate changes on the task branch.
