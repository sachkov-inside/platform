# Integration browser stand preparation

Research for #1510, 2026-10-15. Source revision:
`6460ca4b114eb418a552b72268db945b8fb2fce2`.
This note records source inspection and one successful baseline. It does not claim a measured optimization.

## Baseline attribution

The historical CI checkout is `670237209dc0d5f404193dc09212822d73dd66f3` (113 files, 1039 API tests).
The baseline is [Integration job 116335645893](https://github.com/sachkov-inside/platform/actions/runs/38708780194/job/116335645893).
Times below come from its timestamped log. Boundaries approximate phases rather than instrumenting their internals.

| Phase | Enrollment | Buyer journey |
|---|---:|---:|
| Actions step begins | 09:04:04.154 | 09:05:13.920 |
| `next dev` command begins | 09:04:13.856 | 09:05:23.764 |
| Last route readiness probe completes | 09:04:33.361 | 09:05:38.417 |
| Playwright prints `Running 2 tests` | 09:04:38.076 | 09:05:43.081 |
| Playwright reports success | 09:05:13.468 | 09:06:34.680 |
| Time before `next dev` | 9.70 s | 9.84 s |
| Web startup and route probes | 19.51 s | 14.65 s |
| Playwright launch after probes | 4.72 s | 4.66 s |
| Reported individual test durations | 18.5 + 14.0 s | 26.9 + 22.8 s |

Enrollment's next Actions step starts at 09:05:13.920, so its complete step takes 69.77 seconds.
Buyer reports success at 09:06:34.789; cleanup and step boundaries must remain separate from browser assertion time.
The step's approximate 82-second duration includes preparation, assertions, and cleanup.

The initial 9–10 seconds include command startup, fixture initialization, file polling, and launcher preparation.
Logs do not separate PostgreSQL startup, migrations, seed, Nest startup, or identity initialization.
Assigning a precise duration to any one of those operations would exceed the evidence.
Both fixture sources perform their database and API preparation before writing the readiness file:
[enrollment fixture](https://github.com/sachkov-inside/platform/blob/6460ca4b114eb418a552b72268db945b8fb2fce2/apps/backend/scripts/enrollment-browser-fixture.ts#L11),
[buyer fixture](https://github.com/sachkov-inside/platform/blob/6460ca4b114eb418a552b72268db945b8fb2fce2/apps/backend/scripts/buyer-journey-fixture.ts#L301).

## Safe candidates

1. Disable automatic Git diff capture in the shared full-stack Playwright configuration; retain commit metadata.
   Each launch logs a 3000 ms `git fetch` timeout for the absent PR base commit.
   Playwright 1.63.0's installed `lib/runner/index.js`, lines 766–780, owns this fetch inside `gitDiff`.
   Its plugin checks `captureGitInfo.diff` independently from `captureGitInfo.commit` at lines 669–676.
   Thus `{ diff: false }` removes this network operation without changing test execution or commit identification.
   This is a six-second baseline opportunity across the two launches, not a verified future duration.
   The pinned dependency and public option are recorded in
   [the lockfile](https://github.com/sachkov-inside/platform/blob/6460ca4b114eb418a552b72268db945b8fb2fce2/pnpm-lock.yaml)
   and the installed package's `types/test.d.ts`, lines 1074–1111.
2. Gate enrollment's four unconditional PNG captures per profile with `CAPTURE_EVIDENCE`, matching buyer journey.
   Keep accessibility checks, semantic assertions, and screenshots/traces on failure.
   These captures do not assert image equality. Their runtime cost is not isolated in the log.
   Sources: [enrollment captures](https://github.com/sachkov-inside/platform/blob/6460ca4b114eb418a552b72268db945b8fb2fce2/apps/web/test/fullstack/enrollment.spec.ts#L183),
   [buyer capture policy](https://github.com/sachkov-inside/platform/blob/6460ca4b114eb418a552b72268db945b8fb2fce2/apps/web/test/fullstack/buyer-journey.spec.ts#L149),
   [failure diagnostics](https://github.com/sachkov-inside/platform/blob/6460ca4b114eb418a552b72268db945b8fb2fce2/apps/web/playwright.fullstack.config.ts#L15).
3. Add phase timing before considering fixture consolidation. Instrument database startup, migrations, seed, API readiness,
   route readiness, browser execution, and cleanup. Existing log boundaries cannot prove seed repetition dominates.

## Consolidation limits

Keep the fixtures isolated. Enrollment configures a fixed owner, synthetic JWKS provider, and minimal Product data.
Buyer configures a different issuer, Telegram sign-in provider, SMTP capture, bank double, published demo seed,
and payment recovery loop. These are different runtime contracts, not interchangeable setup functions.
See the fixture sources above and their
[separate launchers](https://github.com/sachkov-inside/platform/blob/6460ca4b114eb418a552b72268db945b8fb2fce2/scripts/buyer-journey-smoke.mjs#L95).

Keep route validation. The shared launcher deliberately restarts a dev server with missing routes,
because a `Ready` message does not prove its complete route graph exists.
The source records prior intermittent failures and requires every scenario route to remain checked:
[route readiness contract](https://github.com/sachkov-inside/platform/blob/6460ca4b114eb418a552b72268db945b8fb2fce2/scripts/smoke-stand.mjs#L132).
Probes currently run sequentially. Bounded parallel probes are an experiment, not established safe consolidation:
verify every route, preserve restart/failure semantics, and measure CPU contention before adoption.

Do not increase enrollment browser workers against its shared owner without separate recipient isolation.
The suite creates project-specific tariffs but mutates the same owner's assignments and open cabinet.
Buyer uses separate Telegram IDs for the profiles, yet shares the API, seed, payment recovery loop, and provider state.
Keeping one worker preserves current deterministic execution while cheaper changes are measured.
Sources: [enrollment scenario](https://github.com/sachkov-inside/platform/blob/6460ca4b114eb418a552b72268db945b8fb2fce2/apps/web/test/fullstack/enrollment.spec.ts#L7),
[buyer identities](https://github.com/sachkov-inside/platform/blob/6460ca4b114eb418a552b72268db945b8fb2fce2/apps/web/test/fullstack/buyer-journey.spec.ts#L70).

No heavy commands, application servers, database containers, provider operations, or acceptance modifications ran during this investigation.

## Candidate experiments

Implementation base is the source revision above. The unchanged local baseline ran
`pnpm test:integration:parallel`: **114 files, 1044 tests passed, 158.39 s**.
This population includes one file and five tests added since the historical CI source;
compare population explicitly rather than attributing that difference to optimization.

The Home baseline ran `pnpm test:integration:parallel home-bounded-read --reporter=verbose`:
**2 tests passed, 54.30 s total, 49.90 s test-file time**.
Pairing independent read-only legacy catalog preparation retained all four real catalog calls,
both Home assertions, the 90/9000-material comparison, SQL/enrichment budgets and database disposal.
The first paired run passed in **46.93 s total, 36.89 s test-file time**.
It overlapped static type checking. A clean paired repeat passed in **38.43 s total,
33.75 s test-file time**; this local result does not establish GitHub runner performance.
No production query or test population was reduced.

The hosted-runner worker candidate reserves one CPU and 2 GiB, allows 1 GiB per file and caps at three.
Shared/local runner resource policy and the serial project's single worker remain unchanged.
Worker-policy tests first failed on the two changed hosted-runner boundaries, then all **13** passed.
The effective CPU, available-memory snapshot and worker count are logged in CI.
A local three-worker run is an experiment, not proof of GitHub-hosted runner performance.

Enrollment and buyer stands remain separate because the source inspection found different mutable
runtime contracts. Route probes and browser worker counts remain unchanged. The candidate disables
only Git diff capture and opt-in PNG production; assertions and failure diagnostics remain enabled.
