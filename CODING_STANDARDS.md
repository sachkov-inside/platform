# Coding standards

This file routes repository-wide rules. Apply the standard nearest to the code being changed:

- backend modules, Nest, Prisma, REST, migrations, and backend tests:
  [`apps/backend/CODING_STANDARDS.md`](apps/backend/CODING_STANDARDS.md);
- Next.js, feature slices, transport adapters, server state, mutations, UI, and browser tests:
  [`apps/web/CODING_STANDARDS.md`](apps/web/CODING_STANDARDS.md).

ADRs explain durable trade-offs; these standards describe the current implementation rules. The
nearest `AGENTS.md` owns task routing and verification commands.

## Repository-wide rules

- Treat every external value as `unknown` until its owning boundary validates it. Infer wire types
  from their schema; introduce a separate domain type only when it adds domain meaning. Reuse the
  repository schema library and built-in formats instead of handwritten format regular expressions.
- Keep one owner for each fact and runtime responsibility. Import its public interface instead of
  duplicating environment parsing, transport paths, schemas, policy, or cache state.
- Prefer a small deep interface at a proven seam. Do not add generic repositories, factories,
  services, or provider abstractions for hypothetical consumers.
- Keep checked-in generated contracts deterministic. Change their source and regenerate them; do
  not hand-edit generated output.
- Name protocol, token, cookie, retry, and polling durations in domain units at the owning boundary.
  Call sites express the policy name, not arithmetic.
- Derive values that are validated together from one clock reading. A window, a deadline pair, or
  any bound another component rechecks must come from a single reading: two readings differ by a
  millisecond often enough to make the rechecking side reject a correct value at random. The
  delivery-command window owns this shape; `notification-wire.test.ts` is its fitness function.

## Waiting in tests

A test that waits by duration measures the machine instead of the behaviour: it hides a defect on an
idle machine and fails at random on a loaded one. No executable check owns this rule, because a
pause is the right instrument for proving that nothing happens, and a mechanical ban on pauses would
reject correct tests. It becomes a fitness candidate if a narrower seam appears.

- End every wait on a committed fact: a persisted row, a rendered state, a drained queue, a reported
  outcome. A pause and an advanced virtual clock start work; neither observes it.
- Wait for the fact the current step produces. A barrier the previous state already satisfies proves
  nothing and leaves the assertion racing the change it was meant to follow.
- Bound a barrier with a budget that only stops a stuck run. Neither raising that budget nor
  re-running the check repairs a flaky test; both hide the cause the failure was pointing at.
- Read the fact without depending on the order of rows that share a sort key: such a read answers
  from an arbitrary row and turns a correct assertion into a coin toss.
- Proving that nothing happened is the exception. Advance a virtual clock past the interval in
  question and assert the absence, once the step before it is already pinned to its own fact.

The nearest standard names the helper for each surface.

## Live HTTP checks

Poll one captured response per attempt. For expected success, use a failing HTTP status as a failed
attempt and inspect the captured successful body. When a non-success status is expected, capture
status and body from the same request. A readiness check proves the live response and accepted
state, not only a running process or copied file.
