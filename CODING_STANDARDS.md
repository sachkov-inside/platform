# Coding standards

This file routes repository-wide rules. Apply the standard nearest to the code being changed:

- Platform backend modules, Nest, Prisma, REST, migrations, and backend tests:
  [`apps/backend/CODING_STANDARDS.md`](apps/backend/CODING_STANDARDS.md);
- Telegram bot modules, Kysely persistence and provider contracts: the repository-wide rules below,
  [application boundaries](apps/telegram/AGENTS.md), [testing standards](apps/telegram/CODING_STANDARDS.md)
  and its executable `guardrails` contract;
- Next.js, feature slices, transport adapters, server state, mutations, UI, and browser tests:
  [`apps/web/CODING_STANDARDS.md`](apps/web/CODING_STANDARDS.md);
- shared workspace packages under `packages/`: these repository-wide rules plus the backend
  standard, because both applications compile that code with the same strict TypeScript and
  type-aware lint configuration. A package keeps no framework, transport or persistence
  dependency of its own.

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
- Every TypeScript project extends `tsconfig.base.json` through its preset:
  `tsconfig.node-lib.json` for `packages/`, `tsconfig.nest-app.json` for the backend,
  `tsconfig.next-app.json` for the web and `tsconfig.scripts.json` for repository `.mjs` scripts.
  Change shared strictness in the base, not per project; `scripts/toolchain-contract.test.mjs`
  fails a project that bypasses it. Where `isolatedDeclarations`
  in packages asks for an exported Zod schema's type, write its exact Zod type, not a hand-written
  wire type.
- `strict-boolean-expressions` (#694) rejects strings, numbers and nullable primitives in a boolean
  context. `hasText` and `presentText` in `apps/backend/src/infrastructure/contracts/text.ts` and
  `apps/web/src/shared/lib/text.ts` keep the former truthiness of text: `null`, `undefined` and `""`
  are absent.
- Repository `.mjs` scripts compile through `tsconfig.scripts.json` in `pnpm typecheck` (#694).
  Every script starts with `// @ts-check` (#756); `scripts/toolchain-contract.test.mjs` fails for a
  script without it, outside that project or with `@ts-nocheck`. A script that loads an
  application's dependency through `createRequire` takes its types from the application's
  `test/support/proof-dependencies`: a type import by a relative path into `node_modules` cannot
  resolve the package's own imports.
- `pnpm lint` applies every `typescript/no-unsafe-*` rule of the shared type-aware set to the files
  `tsconfig.scripts.json` compiles (#763). The root `tsconfig.json` compiles nothing (`files: []`)
  and only references that project, so type-aware lint resolves script types.
  `scripts/toolchain-contract.test.mjs` fails when a script directory, a rule or the reference
  drops out, or when another override or ignore pattern weakens lint for a script. Parse
  `JSON.parse`, `Response.json()` and database rows with a schema, or keep them `unknown` until an
  explicit check; `package.json` is parsed by the schema in `scripts/package-manifest.mjs`. The
  `any` that `createRequire` returns is asserted to its `proof-dependencies` type inside an
  `oxlint-disable`/`oxlint-enable` block for `typescript/no-unsafe-type-assertion`: a
  `disable-next-line` comment inside a JSDoc cast does not suppress it.
- Code that runs at a script's top level calls a module function only after every module `const`,
  `let` and `class` that function reads is declared: a function is hoisted, its values are not, and
  the script fails with `ReferenceError` only when it runs (#774).
  `scripts/check-module-initialization-order.mjs` in `pnpm guardrails` fails a top-level statement
  that calls or passes by name such a function, arrow function or class declaration; a callback the
  statement runs at once, such as one given to `.map()`, is outside the check.
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

Navigation tests wait for the completed RuntimeShell prefetch response of a compatible route shell, not the
whole private Next.js queue (#1182). Route-tree responses and response headers alone do not prove
the shell arrived. Optimistic routing can skip requests for other links that share that shell.
The former `networkidle` exception (#758) is retired: unrelated unfinished requests can exhaust the
test budget after the required shell has arrived. `scripts/quiet-window-waits.test.mjs` rejects
`networkidle` waits in application tests and browser scripts.

Browser suites never retry a failed test, in CI either (owner decision of 2026-09-27, #476): a flaky
test turns the run red on its first attempt and is fixed, not retried until it passes.
`scripts/playwright-specs-load.test.mjs` fails a Playwright configuration that retries.

The nearest standard names the helper for each surface.

## Deterministic test contracts (#1153)

- Test and suite names stay identical across independent runs (#1166). Use fixed values or stable
  case labels when parameterized names interpolate data; random data may remain behind a stable
  name. The deterministic guardrail rejects direct `randomUUID` calls (including named crypto
  import aliases) and `Math.random` in `it`/`test`/`describe` title expressions and inline `each`
  array tables in columns consumed by printf-style title placeholders. Referenced tables,
  `$property` titles, wrappers, clocks and other indirect name dependencies require review; this
  syntax check does not prove stable identity.
- Domain tests do not depend on today's date or the machine's wall clock. Fix one instant per case
  or inject virtual clocks; derive expirations, deadlines and "today" from that instant. Producers
  and consumers share the same clock. Never extend a literal expiry to make a failing test pass.
  Measure elapsed time and polling budgets with monotonic clocks. A fake-timer test registers and
  restores its virtual clock; a real-clock adapter contract names the boundary it verifies.
- Every test creates its own mutable data. A shared immutable template is copied before mutation;
  per-test hooks may reset local double observations. A reused database fixture never lets one
  test rely on rows, counters or provider state left by another test.
- Build, compile, migrate and prepare a large corpus before the test case or measurement starts.
  Keep a bounded setup hook and cleanup for its owned resources. A performance test measures the
  operation it names, not the seed or cold compiler.
- Unit tests use supplied doubles for git, network and process boundaries. A real subprocess or
  owned loopback responder belongs to a named process/adapter contract, with an explicit budget
  and cleanup; it never calls a live external provider.
- Tests and diagnostics that start processes or artificial load own their complete process tree.
  Register cleanup immediately after acquisition. Use an isolated process group, bounded shutdown
  with forced termination, and `finally`/test cleanup hooks; shell commands use an `EXIT` trap and
  signal traps. Preserve the original failure status. Terminating only the launcher is insufficient.
  Verify that no owned process remains after success, failure, timeout and interruption. Test the
  actual cleanup path, not only a mocked `kill` call. Uncatchable termination requires a supervising
  process outside the killed group; a trap alone cannot handle `SIGKILL`.
- `scripts/check-deterministic-tests.mjs` runs in `pnpm guardrails`. It scans JS/TS application
  `test/` trees (including support helpers) and `*.test.*`/`*.spec.*` files across the repository,
  plus root/application `scripts/` commands for process ownership, excluding dependency, fixture
  and generated build directories. It rejects `waitForTimeout`,
  `setTimeout` calls (including member calls), named timer-import aliases, and process/network
  imports or `fetch` calls in `unit/`, `module/` and package test files.
- Direct asynchronous `spawn`/`fork` calls (including named import aliases) require a matching
  child cleanup in `finally` or a test cleanup hook. Delegated cleanup uses a local
  `process-cleanup` reason naming its owner and verification; legacy migrations link #1154.
  This is a syntax check: review proves the group covers descendants, cleanup is registered before
  a failure can happen, its shutdown is bounded, and error/signal paths really execute it. Shell
  traps and indirect process wrappers require behavioral verification and review.
- In tests/support, direct global `new Date()` without arguments, `Date()`, `Date.now()` (including
  global/member computed forms), and named `systemClock` imports require an adjacent `wall-clock`
  reason. Fixed dates and injected clock reads are allowed. A reason names the registered virtual
  clock, real-clock contract or deferred migration issue; it never excuses a calendar-dependent
  assertion. Indirect clock wrappers, namespace/dynamic imports, aliases and expiry literals require
  review: syntax cannot prove that production consumers and fixtures share the fixed time.
- In test/spec files it also rejects direct writes and listed collection mutators on module-level
  object/array literals in modules and plain `describe` callbacks (including exported declarations).
  A syntactic reset in `beforeEach`/`afterEach` permits the binding; review
  must prove the reset is complete. Local shadowed bindings, module initialization and `beforeAll` arrangement are allowed.
- A retained timer must explain its role: polling a fact, bounding failure, modeling latency,
  measuring a performance window, or an external clock. Put
  `// deterministic-test-allow duration-wait: <specific reason>` immediately before that call.
  A local process/adapter contract in a historic unit directory uses `unit-io` before its import or
  call. A cleanup registry or deferred scenario migration uses `shared-mutation` before its
  declaration. An exception never disables a file; deferred violations link their issue (#1154).
- Negative fixtures in `scripts/deterministic-tests.test.mjs` prove each syntax rule rejects a bad
  test or diagnostic, and the CLI fixture proves a nonzero exit. These checks are not proof of determinism:
  indirect wrappers/import effects, escaped objects, mutable class instances, database isolation,
  process lifetime guarantees, complete resets, meaningful barriers and preparation cost require review. A syntactic ban
  cannot identify which observed fact belongs to a step or what work dominates its budget.

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
