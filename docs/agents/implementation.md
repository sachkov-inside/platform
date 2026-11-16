# Implementation

Root [AGENTS.md](../../AGENTS.md#process) owns what starts work. Keep the worktree mode and
ownership in [delivery](delivery.md).

## Acceptance and tests

Without a ticket, state the agreed result, acceptance criteria and the
[key scenarios](human-review.md#agree-in-the-specification) before writing. That list is the
specification for review. Record starting HEAD and the immutable base covering the whole task.
Use TDD where possible; [testing](testing.md) owns the test kinds, the seams and who chooses them.
For a bug or regression whose cause is unknown, find the cause with `diagnosing-bugs` before the fix.
During product implementation, run typechecking and focused test files regularly. Finish with the
verification in root AGENTS.md → Commands.

## Review, verification and delivery

Commit assigned work before `code-review`. Run it once, with independent Standards and Spec
reviewers in parallel over the complete assigned diff; supply immutable base/head and the
requirement source. The implementer fixes every blocking finding, and either fixes each optional
finding or records a one-line reason for leaving it. Rerun affected checks and commit corrections.
There is no re-review. This project rule overrides the re-review steps in the pinned `implement`,
`code-review` and delivery skills until their source updates reach the pinned copies.

Next comes [verification](human-review.md#verification) on the corrected result by a fresh agent,
or one line on why the change needs none. Hand the original review reports, their dispositions and
all commits after the reviewed head to the [classifier](ship.md#owner-attention). Then use `pr`
and `ship` under the target branch's [ship contract](ship.md), with explicit owner decisions for
this task taking precedence over the existing rule they change.
