# Unit CI runtime baseline for issue #1508

## Source and limits

This investigation reads source and one successful CI job. It runs no tests, applications, Docker operations, or production commands.

- Task: [#1508](https://github.com/sachkov-inside/platform/issues/1508).
- Baseline: [CI run 38699695764, Unit tests job 116304741158](https://github.com/sachkov-inside/platform/actions/runs/38699695764/job/116304741158).
- Exact checked source: [`52cead8284a2749388a408afc92770add5185e94`](https://github.com/sachkov-inside/platform/tree/52cead8284a2749388a408afc92770add5185e94). The checkout log explicitly records this SHA.
- Implementation task starts from `00fd99fdb1594bac4c2c0acbafe4ffd27b3a5c8e`. Findings below describe the baseline, rather than claiming identical timing for that newer source.
- Baseline log timestamps: 2026-10-15, 07:35:10 through 07:43:18 UTC. The job API duration is 8:12; emitted log timestamps span approximately 8:09.

Sources linked below are pinned to the checked baseline. Timings are measurements from the linked job. Predictions and experiments are explicitly labelled.

## Main finding

`Unit tests` includes expensive real process supervision and deployment contract checks. The root process contract runner takes **255.34 seconds**, approximately **56% of the 454-second `pnpm check:unit` command**. It is the first optimization target. Removing product unit assertions would miss the main cost.

The owning command is [`package.json`, lines 42–55 and 94–95](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/package.json#L42-L55). CI invokes it unchanged in [`ci.yml`, Unit tests](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/.github/workflows/ci.yml#L115-L131).

## Measured wall time

Command boundaries below use the timestamp of each emitted command and the next command. They therefore include small pnpm/process startup costs. Runner-reported durations exclude some of those costs.

| Sequential command stage | Approximate wall time | Runner evidence |
| --- | ---: | --- |
| Root tooling tests | 67.0 s | Node reports 66.689 s |
| Authoring tooling tests | 4.4 s | Node reports 4.065 s |
| Practice review tests, JavaScript and TypeScript | 3.8 s | Node reports 0.341 s and 2.942 s |
| Recursive non-Web package unit tests | 53.6 s | Backend Vitest 52.17 s; Telegram 25.84 s overlaps |
| Web module tests | 23.4 s | Vitest reports 21.03 s |
| Root deployment/process contract tests | 255.7 s | Node reports 255.341 s, 214 tests pass |
| Backend contract build and tests | 10.5 s | Actual Vitest tests take 4.98 s |
| Web contract tests | 14.7 s | Vitest reports 12.54 s |
| Telegram contract tests | 20.2 s | Vitest reports 19.86 s |

The setup before `pnpm check:unit` takes about 34 seconds. Dependency installation takes 12.25 seconds. It already builds four shared packages and generates Prisma through postinstall hooks. No Playwright installation occurs in this job.

Do not add Backend's 52.17 seconds to Telegram's 25.84 seconds: pnpm runs them concurrently. Do not equate Vitest import or test-duration sums with wall time. For example, Web module imports total 23.97 seconds inside a 21.03-second parallel run.

## Why root contracts take four minutes

[`diagnostic-process-ownership.test.mjs`](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/scripts/contracts/diagnostic-process-ownership.test.mjs#L428-L551) executes:

- 12 launchers multiplied by three owner signals: 36 cases.
- One normal gateway completion case.
- Eight short-launcher failure cases.
- Two cleanup cancellation cases.
- One gateway startup timeout case.

These **48 cases sum to 254.201 seconds of individually reported durations**. They run serially inside one file. Typical cases take 5.2–5.6 seconds. Twelve additional supervisor-unavailable checks and four readiness checks are cheap.

These waits exercise a real guarantee. The fixture descendant ignores SIGTERM and listens on an ephemeral TCP port. The test waits for both owner exit and closure of that actual descendant's TCP connection. Its separate fallback cleanup cannot satisfy the assertion. See [fixture construction, lines 90–157](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/scripts/contracts/diagnostic-process-ownership.test.mjs#L90-L157) and [tree-close assertion and disposal, lines 288–322](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/scripts/contracts/diagnostic-process-ownership.test.mjs#L288-L322).

The process supervisor defaults to five seconds before SIGKILL. This explains the repeated measured delays. See [`owned-process.py`, lines 35–70](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/scripts/owned-process.py#L35-L70) and [`stopOwned`, lines 76–107](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/scripts/owned-process.mjs#L76-L107).

Other root contract costs overlap at file concurrency two:

| Contract suite or cases | Reported duration |
| --- | ---: |
| Production deployment state machine | 112.391 s |
| Owned command supervision Python suite | 62.182 s |
| Six launcher ownership signal cases | Approximately 32.8 s summed |
| Production Web cleanup, three cases | 25.766 s summed |
| Public probe blocked-curl timeout | 10.065 s |

These values are **not additive job wall time**. Node buffers output from concurrent files; adjacent printed timestamps do not establish those files ran sequentially.

## Duplication and builds

1. **No duplicate root contracts job on the same selected plan was established.** `Tooling contracts` explicitly runs tooling and root contracts, but the plan declares `unit` a coverage superset of `contracts`. Normalization removes the redundant narrower job. Preserve this behavior. Sources: [`ci-coverage-plan.mjs`](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/scripts/ci-coverage-plan.mjs#L48) and [workflow tooling job](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/.github/workflows/ci.yml#L78-L94).
2. **Backend contract checks perform a hidden application build.** The script executes `pnpm build` before Vitest. That build regenerates Prisma after installation already generated it. The combined build/startup overhead is roughly 5.5 seconds, including pnpm startup. This is small compared with process waits. Source: [`apps/backend/package.json`, lines 16 and 55](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/apps/backend/package.json#L55).
3. **Production deployment fixtures repeatedly package the same runtime sources.** Every `createHostFixture` creates a fresh fake host and runs the runtime bundle builder. This is repeated preparation, but its independent cost has not been isolated. Source: [`production-deployment.test.mjs`, fixture and bundle construction](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/scripts/contracts/production-deployment.test.mjs#L1901-L2140). Preserve separate writable hosts and legacy-bundle variants.
4. **Tooling contains an intentional local-lock simulation.** One Node wrapper runs all Python lock tests and takes 40.109 seconds. Other tooling costs include Playwright configuration loading, 7.394 seconds, and identity missing-setting checks, 10.852 seconds. These are real executable-boundary tests, not unused production browser runs. Source: [`heavy-check-lock.test.mjs`](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/scripts/heavy-check-lock.test.mjs) and [`heavy-check/test_lock.py`](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/scripts/heavy-check/test_lock.py).

## Ranked experiments

### 1. Bound concurrency of isolated asynchronous cleanup fixtures

Run cleanup cases inside an explicitly bounded suite at concurrency two, then four. Keep the four `fs.writeFileSync`/`renameSync` mock-based readiness cases serial and outside that concurrent suite. Keep every launcher, signal, failure, exit-status, live-TCP assertion, and fallback cleanup.

Isolation evidence: each cleanup fixture owns a unique temporary directory, fake Docker/pnpm boundaries, child processes, IPC stream, record path, and an ephemeral listening port. It does not open the shared stand. Real global filesystem mocks in readiness cases are the reason not to parallelize the entire file blindly.

Prediction: four concurrent wait-heavy cases could reduce this file's 254-second wait sum toward 65–80 seconds. This is **not** a prediction that the complete root contracts runner will take 65–80 seconds. Other files consume its second worker and include the 112-second synchronous deployment suite.

Acceptance: identical test names/counts and statuses; unchanged five-second production grace; no abandoned fixture trees; repeated success under the actual CI runner. Reject a candidate if cleanup races or test instability appear. Measure whole-command wall time and runner minutes.

### 2. Consider isolated CI lanes only after experiment 1

Split application unit checks from tooling/deployment contracts if remaining serial phases still dominate. Keep the stable `Unit tests` aggregate, explicit completeness checks, and source-bound evidence. Keep tooling-only plans complete. This primarily reduces feedback latency; duplicated setup increases runner minutes.

Do not combine this change with higher Vitest worker counts initially. Backend and Telegram already overlap while each uses one worker. Their import costs and two-core CI contention need separate measurement. Sources: [Backend config](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/apps/backend/vitest.config.mts#L3-L12) and [Telegram config](https://github.com/sachkov-inside/platform/blob/52cead8284a2749388a408afc92770add5185e94/apps/telegram/vitest.config.ts#L3-L10).

### 3. Reuse immutable deployment fixture archives

Measure archive construction independently. If material, build a shared immutable archive once per test process and copy it into each fresh fixture. Keep legacy variants immutable and keyed to their actual inputs. Preserve independent host directories, journals, fake command logs, and fail-injection state.

Acceptance: all deployment state-machine cases retain their before/after assertions; source archives do not change across cases; a deliberately modified source changes the archive. Do not replace the 112-second suite with fewer happy-path cases.

### 4. Optimize minor startup costs last

Measure repeated Prisma generation and Vitest configuration loading before adding artifact transfer or cache invalidation logic. The baseline bounds Backend contract build overhead around five seconds. A complex shared-build cache cannot be justified by this measurement alone.

## Decisions recommended

- Preserve all safety and product assertions. No test removal is supported by this baseline.
- Preserve production process termination grace and real descendant ownership checks.
- First reduce serial waiting through bounded fixture concurrency.
- Reassess the entire Unit job after that change; then decide whether isolated CI lanes justify their setup cost.
- Report baseline versus candidate source SHAs, test counts, wall time, runner minutes, failures, and repeat variability.
- Do not merge or queue any candidate under this assignment. The owner explicitly requested an experimental result and a report first.
