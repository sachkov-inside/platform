# Testing

Rules for choosing and writing tests. The `tdd`, `to-spec` and `code-review` skills read this
document as the project's testing contract. How CI selects and runs suites belongs to the
[CI runbook](../runbooks/continuous-integration.md); what an agent runs locally belongs to
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
| Web module | Presentation mapping, query behaviour, BFF route modules, mutation operations | Own modules and schemas in Node | Time; backend and identity through their public adapter, such as `sessionAdapter` | [`billing-subscription-presentation.test.ts`](../../apps/web/test/module/billing-subscription-presentation.test.ts) | `pnpm --filter @inside/web test:module` |
| Web contract | Web tooling lifecycles, such as the run-scoped Vite cache | Subprocesses, temporary files | External services | [`run-scoped-vite-cache.test.ts`](../../apps/web/test/contracts/run-scoped-vite-cache.test.ts) | `pnpm --filter @inside/web test:contracts` |
| Browser engine | Behaviour that differs between Chromium and WebKit | Vite dev server, Chromium, WebKit | Time; backend answers from the test | [`browser-facts.test.ts`](../../apps/web/test/browser-engines/browser-facts.test.ts) | `pnpm --filter @inside/web test:browser-engines` |
| Storybook | A meaningful UI state renders from the production module in its production environment | Chromium through the Vitest browser project | Fetch mocks and fixtures in `apps/web/src/storybook` | [`public-shell.stories.tsx`](../../apps/web/src/_app/ui/public-shell.stories.tsx) | `pnpm test:storybook` |
| Web E2E | Route behaviour and accessibility on the production build | Production Next.js build, Playwright browser | Backend absent or answered by Playwright route interception | [`routes.spec.ts`](../../apps/web/test/e2e/routes.spec.ts) | `pnpm test:e2e` after `pnpm build` |
| Navigation | Page transitions, prefetch and loading states on the production build | Production Next.js build, Playwright browser | Backend as `apps/web/test/navigation/fake-backend.mjs` or a per-spec backend | [`authoring-shell.spec.ts`](../../apps/web/test/navigation/authoring-shell.spec.ts) | `pnpm test:navigation` after `pnpm build` |
| Full-stack | Web/BFF, backend contract and production data flow together | Built Web, backend API and MCP, PostgreSQL, object storage | Synthetic sign-in provider, local bank double | [`material-reader.spec.ts`](../../apps/web/test/fullstack/material-reader.spec.ts) | `pnpm smoke:fullstack`; `pnpm smoke:enrollments` and `pnpm smoke:buyer-journey` for their specs |
| Telegram unit and architecture | Bot module logic; table ownership between modules | Own code in process | Time through `CLOCK`; Telegram Bot API and Platform API | [`activation-view.test.ts`](../../apps/telegram/test/unit/activation-view.test.ts) | `pnpm --filter @inside/telegram test` |
| Telegram integration | Persistence, delivery, queues and workers of the bot | PostgreSQL and RabbitMQ that the session owns, migrations, Kysely | Time through `CLOCK`; Telegram Bot API and Platform API | [`activation-announcement.integration.test.ts`](../../apps/telegram/test/integration/activation-announcement.integration.test.ts) | `pnpm --filter @inside/telegram test:integration` |
| Telegram contract | Delivery, release workflow, deploy gateway and production smoke shell scripts | Subprocesses, temporary files | External services | [`telegram-delivery.test.ts`](../../apps/telegram/test/contracts/telegram-delivery.test.ts) | `pnpm --filter @inside/telegram test:contracts` |
| Telegram widget | Widget layout and screens in a browser | Chromium | Widget data from the test | [`trainer-widget-screens.test.ts`](../../apps/telegram/test/widget/trainer-widget-screens.test.ts) | `pnpm --filter @inside/telegram test:widget` |
| Package unit | Shared package logic | Own code in process | None | [`purchase-terms.test.ts`](../../packages/legal/src/purchase-terms.test.ts) | `pnpm --filter @inside/legal test` |
| Tooling | Root scripts, CI workflow contracts, guardrail checkers with negative fixtures, authoring and practice-review tools | `node:test`, temporary files | Git, network and process doubles | [`deterministic-tests.test.mjs`](../../scripts/deterministic-tests.test.mjs) | `pnpm test:tooling`, `pnpm test:authoring`, `pnpm test:practice-review` |
| Root contract | Release and deploy shell and CLI contracts | Subprocesses, owned loopback responders, temporary files | External services | [`deployment-workflow-contract.test.mjs`](../../scripts/contracts/deployment-workflow-contract.test.mjs) | `pnpm test:contracts` |
| Compose smoke | The development and production Compose stacks start, persist and shut down | Docker Compose, built images | None | [`compose-stack-smoke.sh`](../../scripts/compose-stack-smoke.sh) | `pnpm compose:smoke`, `pnpm compose:production:smoke`; read the [local stand runbook](../runbooks/local-stand.md) first |

Manual proofs outside CI (editor, identity, quiz and Firefox video suites, the production access
pass, `pnpm smoke:health`, `pnpm smoke:billing-contact`, Telegram `proof:course:*`) need their own
stands. [Suites outside CI](../runbooks/continuous-integration.md#suites-outside-ci) lists them.

## Choosing the kind

Prove each behaviour at the lowest kind that can observe it. Add a higher kind only for what the
lower one cannot see: a transport, a browser, a process or the whole stack.

- A domain rule, calculation or mapping gets a unit test.
- Backend behaviour that touches persistence, transactions, idempotency or concurrency gets a
  backend integration test on real PostgreSQL.
- A transport or provider adapter gets a focused mapping test, separate from application
  acceptance.
- A subprocess, compiled entrypoint or owned loopback provider gets a contract test.
- Web presentation mapping, query behaviour and mutation operations get Web module tests.
- A meaningful UI state gets a Storybook story; [frontend delivery](frontend-delivery.md#catalog-stays-in-sync)
  says which surfaces need stories.
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
| A sensitive zone | Also the checks of that zone in [ship](ship.md#sensitive-zones) |
| Guardrail, lint or architecture rule | The check and a negative fixture it rejects |
| CI, release or deploy script | Its tooling or root contract test and negative fixtures |
| Documentation only | No test; `pnpm docs:check` |

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

- Time: a fixed domain instant or a virtual clock shared by producers and consumers. Backend tests
  use `registerFixedClock` from `apps/backend/test/support/fixed-clock.ts`; Telegram injects `CLOCK`.
- Randomness: random fixture data stays behind stable case labels.
- External services: identity providers, the bank, SMTP, Telegram, the other application's API,
  and git, network and processes in tooling tests. Replace them at their public adapter or port,
  or with an owned loopback double. Tests never call a live external provider.

[Deterministic test contracts](../../CODING_STANDARDS.md#deterministic-test-contracts-1153) hold
the review rules for clocks, isolation, setup and process cleanup;
[waiting in tests](../../CODING_STANDARDS.md#waiting-in-tests) holds the rules for barriers.

Known exception: Web module tests replace their own `@/shared` modules with `vi.mock`. On
2026-11-16, 125 of the 166 `vi.mock(` calls in `apps/web` named an `@/shared` module (counted with
`git grep`). The owner decided on 2026-11-16 to leave them for a later architecture audit. A new
test does not add such a replacement; existing ones stay until that audit.

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

Each application keeps its kinds in the directories of the sample paths above; `test/support`
holds shared helpers, and backend integration setup lives in `apps/backend/test/integration/setup`.
Application standards name their own helpers and barriers:
[backend](../../apps/backend/CODING_STANDARDS.md#tests-against-real-infrastructure),
[Web](../../apps/web/CODING_STANDARDS.md#interaction-and-enforcement) and
[Telegram](../../apps/telegram/CODING_STANDARDS.md#test-review).

Name each test after the behaviour it checks, in the domain words of the
[glossary](../../GLOSSARY.md).
