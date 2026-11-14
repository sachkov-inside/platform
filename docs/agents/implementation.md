# Implementation

An explicit implementation assignment starts work; questions, readiness labels and resumed
context alone do not. Keep the worktree mode and ownership in [delivery](delivery.md).

## Acceptance and tests

Without a ticket, state the agreed result and acceptance criteria before writing. That list is
the specification for review. Record starting HEAD and the immutable base covering the whole task.
Use TDD where possible at pre-agreed seams. Respect owner-agreed seams and critical behaviours;
write down the seams under test. Choose remaining seams from acceptance criteria and public
interfaces. Ask the owner when intended behaviour or an agreed boundary is unclear; routine test
selection belongs to the implementer. Give each proposed seam one line on what it catches and misses.
During product implementation, run typechecking and focused test files regularly. Finish with the
verification level in root AGENTS.md: product checks or documentation checks as applicable.

## Review and delivery

Commit assigned work before `code-review`. Supply immutable base/head and the requirement source
for independent Standards and Spec review over the complete assigned diff. The Standards reviewer
reads root CODING_STANDARDS.md and the standards of each changed application. Fix confirmed
findings, rerun affected checks, commit and re-review with the earlier reports, preserving original
full-diff coverage. List unresolved judgement calls. Then use `ship` and the target branch's
[ship contract](ship.md), not proposed gate changes on the task branch.
