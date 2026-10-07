# Coding standards

This file routes repository-wide rules. Apply the standard nearest to the code being changed:

- Platform backend modules, Nest, Prisma, REST, migrations, and backend tests:
  [`apps/backend/CODING_STANDARDS.md`](apps/backend/CODING_STANDARDS.md);
- Telegram bot modules, Kysely persistence and provider contracts: the repository-wide rules below,
  [application boundaries](apps/telegram/AGENTS.md) and its executable `guardrails` contract;
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
- Every TypeScript project extends `tsconfig.base.json` through its `tsconfig.*.json` preset and
  changes shared strictness only in the base; `scripts/toolchain-contract.test.mjs` holds both.
  Where `isolatedDeclarations` in packages asks for an exported Zod schema's type, write its exact
  Zod type, not a hand-written wire type.
- Where `strict-boolean-expressions` (#694) rejects a text value, `hasText` and `presentText` keep
  its former truthiness (`null`, `undefined` and `""` are absent). They live in
  `apps/backend/src/infrastructure/contracts/text.ts` and `apps/web/src/shared/lib/text.ts`.
- Repository `.mjs` scripts start with `// @ts-check` (#756) and compile and lint through
  `tsconfig.scripts.json` with every `typescript/no-unsafe-*` rule of the shared type-aware set
  (#694, #763); `scripts/toolchain-contract.test.mjs` holds the comment, the project and the rules.
  Parse `JSON.parse`, `Response.json()` and database rows with a schema, or keep them `unknown`
  until an explicit check; `package.json` is parsed by the schema in `scripts/package-manifest.mjs`.
- A script that loads an application's dependency through `createRequire` takes its types from the
  application's `test/support/proof-dependencies`: a type import by a relative path into
  `node_modules` cannot resolve the package's own imports. Assert the returned `any` to that type
  inside an `oxlint-disable`/`oxlint-enable` block for `typescript/no-unsafe-type-assertion`: a
  `disable-next-line` comment inside a JSDoc cast does not suppress it.
- Code at a script's top level calls a module function only after every module `const`, `let` and
  `class` that function reads is declared: a function is hoisted, its values are not (#774).
  `scripts/check-module-initialization-order.mjs` holds a call or a pass by name; a callback that
  the statement runs at once, such as one given to `.map()`, is outside the check.
- Scripts pass every failure on through their exit code and run under macOS bash 3.2: they use no
  `wait -n` and expand no empty array under `set -u`.
- Keep checked-in generated contracts deterministic: change one through its source and regenerate
  it, never by hand.
- Name protocol, token, cookie, retry, and polling durations in domain units at the owning boundary.
  Call sites express the policy name, not arithmetic.
- Derive values that are validated together from one clock reading. A window, a deadline pair, or
  any bound another component rechecks must come from a single reading: two readings differ by a
  millisecond often enough to make the rechecking side reject a correct value at random. The
  delivery-command window owns this shape; `notification-wire.test.ts` is its fitness function.

## Waiting in tests

A test that waits by duration measures the machine instead of the behaviour: it hides a defect on an
idle machine and fails at random on a loaded one. Review holds the rules below as a whole: a pause
is the right instrument for proving that nothing happens, so a mechanical ban would reject correct
tests.

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

One wait ends on a quiet window instead of a fact (owner decision of 2026-09-27, #758):
`viewportPrefetchDrained` in `apps/web/test/navigation/instant-navigation.spec.ts` waits for
`networkidle`. The Next.js prefetch queue is private module state, and optimistic routing skips
requests for links whose route it predicts, so no page-visible fact marks the end of the queue.
Revisit it when Next.js exposes the queue or optimistic routing changes.
`scripts/quiet-window-waits.test.mjs` fails any other `networkidle` wait in the application tests
and browser scripts.

Browser suites never retry a failed test, in CI either (owner decision of 2026-09-27, #476): a flaky
test turns the run red on its first attempt and is fixed, not retried until it passes.
`scripts/playwright-specs-load.test.mjs` fails a Playwright configuration that retries.

The nearest standard names the helper for each surface.

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
