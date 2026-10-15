# Coding standards

Reviewers apply these shared judgement rules and the standards for each changed surface.
Implementers consult a specific rule only when a concrete question needs it; `WORKFLOW.md` owns the review process.

- Platform backend modules, Nest, Prisma, REST, migrations, and backend tests:
  [`apps/backend/CODING_STANDARDS.md`](apps/backend/CODING_STANDARDS.md);
- Telegram bot modules, Kysely persistence and provider contracts: the repository-wide rules below,
  [application boundaries](apps/telegram/AGENTS.md), [testing standards](apps/telegram/CODING_STANDARDS.md)
  and its executable `guardrails` contract;
- root repository scripts: these shared rules plus [script context](scripts/AGENTS.md);
- Next.js, feature slices, transport adapters, server state, mutations, UI, and browser tests:
  [`apps/web/CODING_STANDARDS.md`](apps/web/CODING_STANDARDS.md);
- shared workspace packages under `packages/`: these repository-wide rules plus the backend
  standard where applicable. Nest composition, REST and Prisma rules do not apply to packages.
  A package keeps no framework, transport or persistence dependency of its own;

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
- Preserve shared compiler strictness. [Toolchain contracts](scripts/toolchain-contract.test.mjs)
  own preset/configuration checks. Exported package schemas retain their exact Zod type when
  `isolatedDeclarations` requires an annotation, rather than a duplicated wire type.
- Keep checked-in generated contracts deterministic: change one through its source and regenerate
  it, never by hand.
- Name protocol, token, cookie, retry, and polling durations in domain units at the owning boundary.
  Call sites express the policy name, not arithmetic.
- Derive values that are validated together from one clock reading. A window, a deadline pair, or
  any bound another component rechecks must come from a single reading: two readings differ by a
  millisecond often enough to make the rechecking side reject a correct value at random. The
  delivery-command window owns this shape; `notification-wire.test.ts` is its fitness function.

## Collection reads and pagination

- Read collection facts through owner-scoped sets. Deduplicate and chunk IDs to supported bounds;
  preserve tenant, account, publication and authorization predicates.
- Measure repeated work at its I/O boundary: owner calls, SQL statements and provider requests are
  separate counts. `Promise.all` changes concurrency; ORM batching needs actual statement evidence.
- Keep required locks, ordered writes, checkpoints and provider effects. Batch reusable reads within
  their valid snapshot; recheck facts at the boundary that commits or dispatches an action.
- Declare whether a list is complete, paginated, a recent window or a bounded composition. Enforce
  composition limits at their owner. An internal safety budget cannot silently truncate a complete list.
- Bound prerequisite reads as well as the returned page. Apply eligibility before a limit when the
  contract promises eligible results; otherwise preserve continuation through filtered source rows.
- A cursor preserves filters and a stable total order, including a unique tie-breaker. Every accepted
  sort-key value must encode into a cursor accepted by request and response schemas.
- Report traversal failures separately from exhaustion. A filtered empty page with continuation is
  still traversable. A failed continuation stays retryable; only exhaustion completes traversal.

## Waiting in tests

A test that waits by duration measures the machine instead of the behaviour: it hides a defect on an
idle machine and fails at random on a loaded one. No executable check owns this rule as a whole,
because a pause is the right instrument for proving that nothing happens, and a mechanical ban on
pauses would reject correct tests; the ban on network-idle waits below has its own check.

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

Browser suites fail on the first attempt, including CI. The
[Playwright configuration contract](scripts/playwright-specs-load.test.mjs) rejects retries;
[quiet-window checks](scripts/quiet-window-waits.test.mjs) reject `networkidle` waits.
The nearest standard names surface-specific helpers and barriers.

## Deterministic test contracts (#1153)

- Test and suite names stay identical across independent runs. Keep random fixture data behind
  stable case labels. Review indirect title dependencies, including referenced tables and clocks.
- Fix one domain instant per case or inject a virtual clock shared by producers and consumers.
  Derive expirations, deadlines and "today" from it; changing a literal expiry cannot repair a test.
  Use monotonic clocks for elapsed time and polling budgets. Register and restore virtual clocks;
  a real-clock adapter contract names the boundary it verifies.
- Each test owns its mutable data, database rows and provider state. Copy immutable templates before
  mutation. Review complete per-test resets, escaped objects and mutable instances, not just literals.
- Compile, migrate and prepare large corpora in bounded setup hooks before the case or measurement.
  A performance test measures the named operation rather than seed or cold compiler work.
- Unit tests supply git, network and process doubles. Real subprocess and owned loopback contracts
  name their boundary, failure budget and cleanup; they never call live external providers.
- Tests and diagnostics own their complete process tree. Register cleanup immediately after acquisition;
  use isolated process groups, bounded shutdown, forced termination and `finally`/test cleanup hooks.
  Shell commands use `EXIT` and signal traps and preserve the original failure status. Verify actual
  cleanup after success, failure, timeout and interruption; killing only a launcher is insufficient.
  Uncatchable termination needs a supervisor outside the killed group; traps cannot handle `SIGKILL`.

The [deterministic syntax check](scripts/check-deterministic-tests.mjs) runs in `pnpm guardrails`.
Its [implementation](scripts/deterministic-tests.mjs) and
[negative fixtures](scripts/deterministic-tests.test.mjs) own the detected syntax and CLI rejection contract.
Review still proves meaningful barriers, clock sharing, isolation, preparation cost and process lifetime,
including indirect wrappers and imports. A passing syntax check proves none of those semantics.

Local `deterministic-test-allow` reasons name the actual exception and its owner:

- `duration-wait`: polling a fact, bounding failure, modeling latency, a performance window, or an external clock;
- `wall-clock`: the registered virtual clock, named real-clock contract, or deferred migration;
- `unit-io`: a named process/adapter contract retained in a historic unit directory;
- `process-cleanup`: the delegated cleanup owner and its verification;
- `shared-mutation`: the cleanup registry or deferred scenario migration.

Place the reason immediately before its owning call, import or declaration; exceptions never exempt a file.
Deferred violations link their migration issue (#1154). A reason cannot excuse a calendar-dependent assertion,
incomplete reset or unowned process. Review those requirements even when syntax accepts the exception.

## Live HTTP checks

Poll one captured response per attempt. For expected success, use a failing HTTP status as a failed
attempt and inspect the captured successful body. When a non-success status is expected, capture
status and body from the same request. A readiness check proves the live response and accepted
state, not only a running process or copied file.

## Text that describes the system

Documents, code comments and check output in the diff that say how the system behaves are claims
about the code (#897). Review checks each claim against the file, history or log that owns the fact
and cites that source in the finding.

- A claim about which process, route, operation, audience, error code, test or check does something
  matches its owning file on the reviewed head.
- A quantifier such as all, only or none holds for every case in the owning source, or the text
  names the exception.
- A number aggregated over runs or logs names its source and period. Two numbers for one quantity
  say why they differ. A conclusion drawn from a measurement gives the measured values.
- A reference to a list, section or suite names its items or resolves to them.
- A statement about a past or planned state names its issue or date, so it does not read as current.
- A check's success message, or a sentence saying a test or check covers something, names only what
  that check asserts.
- When the diff removes a described behaviour, every document on the reviewed head that described it
  says it is gone, or one linked issue lists that document.
