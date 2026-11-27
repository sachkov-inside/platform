# Testing

Rules for choosing and writing tests. This is the project's testing contract; the `tdd`, `to-spec`
and `code-review` skills reach it through root `AGENTS.md`. How CI selects and runs suites belongs
to the [CI runbook](../runbooks/continuous-integration.md); what an agent runs locally belongs to
[AGENTS.md → Commands](../../AGENTS.md#commands).

Every test follows one principle: break the behaviour and the test fails; change only the
internals and the test passes.

## Test kinds and seams

A **seam** is the public boundary a test calls the code through and observes the result at. Start
a new test from the sample of its kind.

| Kind | Proves | Real dependencies | Substitutes | Sample | Command |
|---|---|---|---|---|---|
| Backend unit and adapter | Domain rules, `MaterialBody`, pure functions; transport and provider mapping in a focused adapter test | Own code in process | Time; external providers behind their port | [`billing-command-fingerprint.test.ts`](../../apps/backend/test/unit/billing-command-fingerprint.test.ts) | `pnpm --filter @inside/backend test` |
| Backend integration | Application behaviour through capability interfaces: persistence, transactions, constraints, rollback, idempotency, concurrency; real Nest HTTP and MCP transport | PostgreSQL through Testcontainers, migrations, Prisma; RustFS and RabbitMQ in the files that own them | Time; other applications and providers through owned doubles such as `apps/backend/test/support/telegram-contacts-double.ts` | [`account-profiles.test.ts`](../../apps/backend/test/integration/account-profiles.test.ts) | `pnpm test:integration` |
| Backend contract | Compiled entrypoints and processes: worker startup, SMTP, bank double over HTTP | Built entrypoints, subprocesses, owned loopback servers, temporary files | External providers as owned loopback responders | [`smtp-transport.test.ts`](../../apps/backend/test/contracts/smtp-transport.test.ts) | `pnpm --filter @inside/backend test:contracts` |
| Web module | Presentation mapping, query behaviour, BFF route modules, mutation operations | Own modules, session, SDK, adapters and schemas in Node | Time; external backend and identity over HTTP | [`billing-subscription-presentation.test.ts`](../../apps/web/test/module/billing-subscription-presentation.test.ts) | `pnpm --filter @inside/web test:module` |
| Browser engine | Browser behaviour that a Node module test cannot see: caches between documents, history, SVG and sign-in in a real engine | Vite dev server or a fixture page, Chromium and, where a test asks for it, WebKit | Time; backend answers from the test | [`reader-history.test.ts`](../../apps/web/test/browser-engines/reader-history.test.ts) | `pnpm --filter @inside/web test:browser-engines` |
| Web E2E | Route behaviour and accessibility on the production build | Production Next.js build, Playwright browser | Backend absent or answered by Playwright route interception | [`routes.spec.ts`](../../apps/web/test/e2e/routes.spec.ts) | `pnpm test:e2e` after `pnpm build` |
| Navigation | Page transitions, prefetch and loading states on the production build | Production Next.js build, Playwright browser | Backend as `apps/web/test/navigation/fake-backend.mjs` or a per-spec backend | [`authoring-shell.spec.ts`](../../apps/web/test/navigation/authoring-shell.spec.ts) | `pnpm test:navigation` after `pnpm build` |
| Full-stack | Web/BFF, backend contract and production data flow together | Built Web, backend API and MCP, PostgreSQL, object storage | Synthetic sign-in provider, local bank double | [`material-reader.spec.ts`](../../apps/web/test/fullstack/material-reader.spec.ts) | `pnpm smoke:fullstack`; `pnpm smoke:enrollments` and `pnpm smoke:buyer-journey` for their specs |
| Telegram unit and architecture | Bot module logic; table ownership between modules | Own code in process | Time through `CLOCK`; Telegram Bot API and Platform API | [`activation-view.test.ts`](../../apps/telegram/test/unit/activation-view.test.ts) | `pnpm --filter @inside/telegram test` |
| Telegram integration | Persistence, delivery, queues and workers of the bot | PostgreSQL and RabbitMQ that the session owns, migrations, Kysely | Time through `CLOCK`; Telegram Bot API and Platform API | [`activation-announcement.integration.test.ts`](../../apps/telegram/test/integration/activation-announcement.integration.test.ts) | `pnpm --filter @inside/telegram test:integration` |
| Telegram contract | Delivery, release workflow, deploy gateway and production smoke shell scripts | Subprocesses, temporary files | External services | [`telegram-delivery.test.ts`](../../apps/telegram/test/contracts/telegram-delivery.test.ts) | `pnpm --filter @inside/telegram test:contracts` |
| Telegram widget | Widget layout and screens in a browser | Chromium and WebKit | Widget data from the test | [`trainer-widget-screens.test.ts`](../../apps/telegram/test/widget/trainer-widget-screens.test.ts) | `pnpm --filter @inside/telegram test:widget` |
| Package unit | Shared package logic | Own code in process | None | [`purchase-terms.test.ts`](../../packages/legal/src/purchase-terms.test.ts) | `pnpm --filter @inside/legal test` |
| Tooling | Root scripts, CI workflow contracts, guardrail checkers with negative fixtures, authoring and practice-review tools | `node:test`, temporary files | Git, network and process doubles | [`deterministic-tests.test.mjs`](../../scripts/deterministic-tests.test.mjs) | `pnpm test:tooling`, `pnpm test:authoring`, `pnpm test:practice-review` |
| Root contract | Release and deploy shell and CLI contracts | Subprocesses, owned loopback responders, temporary files | External services | [`deployment-workflow-contract.test.mjs`](../../scripts/contracts/deployment-workflow-contract.test.mjs) | `pnpm test:contracts` |
| Compose smoke | The development and production Compose stacks start, persist and shut down | Docker Compose, built images | None | [`compose-stack-smoke.sh`](../../scripts/compose-stack-smoke.sh) | `pnpm compose:smoke`, `pnpm compose:production:smoke`; read the [local stand runbook](../runbooks/local-stand.md) first |

Manual proofs outside CI (editor, identity, quiz and Firefox video suites, the production access
pass, `pnpm smoke:health`, `pnpm smoke:billing-contact`, Telegram `proof:course:*`) need their own
stands. [Suites outside CI](../runbooks/continuous-integration.md#suites-outside-ci) lists them.

## Choosing the kind

Prove each behaviour with the lowest kind that can observe it, and add a higher kind only for what
the lower one cannot see: a transport, a browser, a process or the whole stack. Within a kind, call
the highest public seam that reaches the behaviour.

- A domain rule, calculation or mapping gets a unit test.
- Backend behaviour that touches persistence, transactions, idempotency or concurrency gets a
  backend integration test on real PostgreSQL.
- A transport or provider adapter gets a focused mapping test, separate from application
  acceptance.
- A subprocess, compiled entrypoint or owned loopback provider gets a contract test.
- Web presentation mapping, query behaviour and mutation operations get Web module tests.
- Route behaviour and accessibility get a Web E2E test; page transitions and prefetch get a
  navigation test.
- A change to a backend contract the Web uses, to a BFF route, to query ownership or to a
  production data flow gets a full-stack scenario.
- A change to who may do what updates the test that the
  [access-check matrix](../runbooks/continuous-integration.md#access-checks) cites for that cell.
- A mechanically detectable coding rule gets its check with negative fixtures, as the
  [documentation maintenance contract](documentation-maintenance.md) says.

Respect seams and critical behaviours the owner agreed in the task or specification. The
implementer chooses the remaining seams from the acceptance criteria and public interfaces, and
writes down each seam under test with one line on what it catches and what it misses. Ask the
owner when the intended behaviour or an agreed boundary is unclear.

## When a test is required

| Change | Rule |
|---|---|
| New behaviour | Write the test first and watch it fail, then write the code |
| Bug fix | First a test that reproduces the bug and fails, then the fix |
| Behaviour change | Change the test first and watch it fail, then change the code |
| Refactoring | Existing tests pass unchanged; pin uncovered behaviour with a test before the refactoring |
| A consequence trigger | Also the checks of that trigger in [human participation](human-review.md#consequence-triggers) |
| Guardrail, lint or architecture rule | The check and a negative fixture it rejects |
| CI, release or deploy script | Its tooling or root contract test and negative fixtures |
| Documentation only | No test; `pnpm docs:check` |

## Independent red evidence

For a bug fix, the implementer records the failing-before and passing-after commands, immutable
base/fixed commits and outputs. Reviewers remain read-only. A fresh verifier confirms the red
result by running the new regression test against the base implementation in an isolated,
task-owned test context, then the same test against the fixed implementation. It records both
results and distinguishes the expected assertion failure from setup or dependency failures.
This evidence check is needed even when application verification is unnecessary. If the base
cannot run, record «Не проверено»; the classifier cannot use the independently proven bug-fix
exemption. Never check out the base in another agent's active worktree.

## Where expected values come from

Take expected values from the first source that defines them:

1. The specification or contract document: `docs/specifications`, `docs/contracts`, the generated
   OpenAPI document and `apps/backend/mcp/tool-surface.json`.
2. The acceptance criteria of the issue.
3. The existing test of a behaviour that the change preserves.
4. The reproduction of the bug.

Write expected values as literals. Never take them from the code under test or recompute them the
way the code does. When no source defines a value, ask the owner.

## Substitutes

A test replaces only time, randomness and external services. Our own modules, PostgreSQL,
migrations, Prisma, Kysely and RabbitMQ stay real wherever the kind above lists them.

- Time and randomness: backend tests use `registerFixedClock` from
  `apps/backend/test/support/fixed-clock.ts`; Telegram injects `CLOCK`.
  [Deterministic test contracts](../../CODING_STANDARDS.md#deterministic-test-contracts-1153) hold
  the rules for clocks, random fixture data, isolation and process cleanup.
- External services: identity providers, the bank, SMTP, Telegram and the other application's API.
  For the Web kinds the backend is an external service too: Web reaches it only over HTTP, so a
  Web test may answer that HTTP itself. Tooling tests also replace git, the network and processes.
  Replace a service at its public adapter or port, or with an owned loopback double.

A named transport-corruption test may change only the delivered bytes of an exact request after
its real handler has returned and the valid success has been checked and consumed. Keep a paired
normal path and the separate real-BFF rejection of malformed backend data. This is synthetic wire
fault injection, not an own-module substitute or proof of real network corruption; unexpected
requests fail. A generic transport contract may configure a synthetic operation through the real
factory and handler's declared callback port, without replacing a product operation or session.
The two existing Telegram 503 diagnostic tests may add only `x-correlation-id: read-reference`
after checking and consuming the real failure, preserving its bytes, status and other headers.
Keep each ordinary failure without that header. This named metadata fault tests the browser's
diagnostic forwarding; the current BFF does not forward that header.

[Waiting in tests](../../CODING_STANDARDS.md#waiting-in-tests) holds the rules for barriers.

Web tests exercise their own Route Handler/BFF, session, SDK and backend adapter. Replacing an
own callable default, supplying a fake existing BFF to a browser adapter, or changing an own spy's
implementation is the same substitution as a module mock. A required configuration callback is a
port; a supplied callback that displaces an own default is a substitute. Observational spies,
`spy: true`, and factories returning the exact actual module preserve its exports and results.
Review and verification establish those semantic claims; the architecture checker rejects the
concrete registration, alias, overwrite and callable-default forms with negative fixtures.

The [accepted #2292 platform decision](https://github.com/sachkov-inside/platform/issues/2292#issuecomment-6943695123)
permits only these existing Node/tooling environment seams. The current owner is #2292,
dispatch `ctx_6da5a858c6db`; there is no exception for an own module or an entire vendor package.
Paths below are relative to `apps/web`.

| API and owning fixture | What the seam proves and misses |
|---|---|
| `next/server.connection`, `test/support/request-scope.ts` | Supplies an already connected Node-test scope, retaining the other actual exports. It does not prove prerender or prefetch interruption. |
| `next/cache.cacheLife`, `cacheTag`, `revalidateTag`, `test/module/authoring-write-expires-catalog.test.ts` and `test/module/mutation-operation.test.ts`; the environment alias `test/support/next-cache.ts` | Observes requested lifetime, tags and invalidation, not compiled cache retention. Own cache policy and adapters run. |
| `next/server.after`, `test/module/client-report-limits.test.ts` and `test/module/client-telemetry-bff.test.ts` | Drops deferred work only for immediate protocol, rate and log assertions. These fixtures prove no deferred write or lifecycle outcome. |
| `next/server.after`, `test/module/web-telemetry-forwarding.test.ts` | Retains and executes the actual callback and backend HTTP. Returns-before-persistence, no identity forwarding and errors remain asserted. It does not prove the Next scheduler. |
| `server-only`, `test/module/logto-sdk-callback.test.ts`; the environment alias `test/support/server-only.ts` in the module and smoke Vitest configs | Supplies the conditional import marker in Node. Production browser import restrictions remain enforced. |

A new coordinator supplement on 2026-11-17 (`msg_c1b30d246cd4`, under #2292) accepts framework aliases for this browser fixture. Keep their inventory separate from
`vi.mock` registrations.

| Exact alias context | Accepted framework input and limit |
|---|---|
| `test/browser-engines/course-reading-handoff.test.ts`: `next/link` → `test/support/next-link.tsx`, `next/navigation` → `test/support/course-reading-router.ts` | The link adapter renders an anchor and reports `pending: false`. Own UI runs with actual window/popstate and a controlled ready promise as its framework input. |

The coordinator's integration decision on 2026-11-17 (`msg_712cfa4e643a`, under #2292) adds
exactly one existing alias from merged PR #2296: `test/browser-engines/owner-fact-announcements.test.ts`
maps `next/navigation` to `file-preview/next-navigation.ts` (Git blob
`67be42599debdbc5f59762e379bd49113fc87d8a`). Its five exports are `ReadonlyURLSearchParams`,
`usePathname`, `useParams`, `useRouter` and `useSearchParams`. Pathname/search come from the window,
params are empty, back/forward call window history, push/replace load a document, prefetch resolves
a Promise and refresh does nothing. Actual query hooks, QueryClient and Rules/Promotions panels
prove fact reads/refresh for sibling observers and independent caches. They do not prove Next
navigation, PPR, prefetch, refresh or framework lifecycle. This alias permits no other consumer or
direct adapter import. The existing file preview is unchanged and is not newly scanned as a test
context; the default checker additionally inspects only this adapter's accepted exports/body.

Keep the counts separate: external non-Node framework aliases are five entries/four adapters/three
contexts; including the three Node cache/marker aliases gives eight entries/six adapters/five
contexts. These counts do not include `vi.mock` or observational spy registrations.

These ports do not prove actual Next navigation, history delivery, PPR, prefetch, pending state or
framework lifecycle. Keep the real production Next/Navigation scenarios. The checker fixes exact
alias targets, resolved adapter paths and owning contexts, and checks their known exports/body AST
without comments or source positions. Adding API or behaviour requires updating the owning decision
and negative fixtures; these are six explicit framework adapters, including the Node cache/marker,
not an own-module baseline. The handoff shim stays out of production and module contexts. Review
and independent verification still assess the semantic limits; the checker does not infer them.

Any test claiming deferred execution, persistence or framework lifecycle needs the actual callback
or framework context. A no-op in the forwarding fixture or outside the two immediate fixtures is
rejected. Structural checks cover the known API/factory forms, not arbitrary JavaScript evaluation
or the truth of prose in a test name. Historical mock counts are evidence, never an allowlist.

## Flaky tests

A flaky test is a failing test: diagnose its cause before delivering the affected work. Neither a
retry nor a larger time budget repairs a test; both hide the cause. Browser suites fail on the
first attempt, including CI: the
[Playwright configuration contract](../../scripts/playwright-specs-load.test.mjs) rejects retries.
[Ship → CI failures](ship.md#ci-failures) owns the one re-run of an unrelated CI failure;
[manual flake investigation](../runbooks/continuous-integration.md#manual-flake-investigation)
repeats suites to detect flakes.

There is no coverage threshold. Add a test because a behaviour needs it.

## Placement and naming

The Vitest and Playwright configurations of each application define which directory holds which
kind. Backend unit and adapter tests live in `apps/backend/test/unit`, `apps/backend/test/adapters`
and directly in `apps/backend/test`. `test/fixtures` holds test data, `test/support` holds shared
helpers, and backend integration setup lives in
`apps/backend/test/integration/setup`. Application standards name their own helpers and barriers:
[backend](../../apps/backend/CODING_STANDARDS.md#tests-against-real-infrastructure),
[Web](../../apps/web/CODING_STANDARDS.md#interaction-and-enforcement) and
[Telegram](../../apps/telegram/CODING_STANDARDS.md#test-review).

Name each test after the behaviour it checks, in the domain words of the
[glossary](../../GLOSSARY.md).
