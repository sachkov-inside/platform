# Continuous integration

Platform pull requests into `main` are protected by `.github/workflows/ci.yml`. The workflow has
read-only repository access, does not read repository or environment secrets and runs only on
GitHub-hosted `ubuntu-24.04` runners. A new commit cancels an older first attempt for the same pull
request. Reruns use a separate concurrency group identified by their run ID: an old rerun cannot
cancel a newer first attempt. A new commit also leaves an already running rerun in its own group.
The same workflow runs for the `main` merge queue (`merge_group`).

The workflow is also callable through `workflow_call`. Both ordinal release workflows (`release.yml` and `telegram-release.yml`) invoke this
same contract with its captured, exact source SHA before it publishes images. Every checkout in the
reusable path uses that SHA, so a moving branch cannot change the candidate during CI. Direct
pushes do not start application CI; the protected `main` branch accepts changes only through the
merge queue with a successful `CI Gate`.

## Required checks

`pnpm check` is the aggregate of four stages, and each stage runs as its own job, so a failure
names its seam and the stages run in parallel:

| Job | Repository command or proof |
|---|---|
| `static` | `pnpm check:static`: documentation contract, Prettier formatting, workspace packages and Prisma client, OpenAPI drift, lint, typecheck, guardrails |
| `unit` | `pnpm check:unit`: tooling and authoring `node --test`, backend and package Vitest, web module tests, then the separate `pnpm check:contracts` commands |
| `ui` | `pnpm check:ui`: browser-engine checks (Chromium and WebKit), Storybook tests and the Storybook build |
| `web-e2e` | `pnpm check:web-e2e`: one production build, prerendered and standalone checks, then Playwright e2e and page transitions on `next start` of that build |
| `telegram` | `pnpm --filter @inside/telegram check:full` с изолированными PostgreSQL 18.4 и RabbitMQ, synthetic non-guest user |
| `integration` | `pnpm test:integration:parallel` (PostgreSQL and RustFS via Testcontainers, a migrated template database copied per test database), then `pnpm smoke:enrollments` and `pnpm smoke:buyer-journey`; a failed job uploads the Playwright results and the `next dev` log |
| `integration-serial` | `pnpm test:integration:serial`: RabbitMQ, SIGKILL crash and worker-process files, one file at a time |
| `compose-development` | profile config/build, live smoke, restart persistence and clean shutdown |
| `compose-production` | isolated nine-process digest-selected runtime proof with the environment broker; pull requests also run clean `pnpm release:images:smoke` |

`.github/actions/setup-platform` owns the shared setup: pinned pnpm and Node.js, the frozen
install and, on request, Playwright browser engines restored from a cache keyed by the exact
Playwright version. The system packages for those engines come from a second cache of `.deb`
files keyed by browsers, Playwright version and runner image, because the Ubuntu mirror can stall
long enough to cancel the job (#827). Only runs on `main` save that cache: `release.yml` and
`telegram-release.yml` call this workflow there. Pull requests and the merge queue only restore it.
After a runner image update they restore the previous entry and download only the changed packages
until the next release saves a new one.

The archive cache does not skip apt index updates. `scripts/install-playwright-ci.sh` bounds
system-package installation to 180 seconds per attempt, then kills the whole process group as root.
HTTP and HTTPS connection and data waits time out after 15 seconds and retry once; index errors fail
the installation. After a failed first attempt the script replaces only the Azure Ubuntu mirror
with `https://archive.ubuntu.com` and retries once. This also replaces the original HTTP scheme:
the previous fallback preserved HTTP on the highest-priority mirror despite an existing HTTPS
entry on the runner. In #1107 that HTTP source waited until the deadline; the log does not
establish the provider's internal network failure cause. A failed second attempt fails the job before browser
downloads. The replacement covers `.list`, deb822 `.sources` and the GitHub runner's
`/etc/apt/apt-mirrors.txt`, preserving mirror priorities. The same script installs browsers for Production access pass and the nightly full-stack
smoke; production deployment commands and access-pass requests keep their existing contracts.

`CI Gate` depends on every job and succeeds only when every result is `success`. The repository
ruleset requires this exact check name; individual job names may evolve without changing the
branch-protection interface.

### Local contract tests

`pnpm check:contracts` owns local process and adapter contracts, separately from unit/module
selection. The existing `unit` CI job runs this command after its unit checks; `pnpm check`
therefore retains all migrated checks. The contracts call owned loopback responders, local
subprocesses and temporary filesystems, without live providers or production credentials.

| Selection | Contract |
|---|---|
| Root `pnpm test:contracts` | Release/deploy shell and CLI contracts in `scripts/contracts/*.test.mjs` |
| Backend `pnpm --filter @inside/backend test:contracts` | Worker startup, bank-double ledger/process/HTTP and SMTP in `test/contracts`; the command builds once before Vitest and launches compiled entrypoints |
| Web `pnpm --filter @inside/web test:contracts` | Run-scoped Vite cache lifecycle in the `contracts` project |
| Telegram `pnpm --filter @inside/telegram test:contracts` | Delivery, release workflows, deploy gateway and production smoke shell contracts in `test/contracts` |

These commands use the shared heavy-check slots. Backend unit selection excludes `test/contracts`.
Telegram unit selection includes only `test/unit` and `test/architecture`; Web module selection
includes only `test/module`. Telegram `check:full` also retains its contract selection.
The timer-only process-failure checks and
in-memory bank-double behaviour remain unit tests. Synchronous Telegram commands run through the external owned CLI with a 30-second default deadline;
the deadline sends TERM to its Node owner, which waits for Python's bounded TERM/KILL cleanup before exit.
Other synchronous contract commands have explicit termination budgets; asynchronous process contracts observe close and register cleanup.

## Merge queue

`main` merges through the GitHub merge queue (owner decision of 2026-09-24). A pull request needs a
successful `CI Gate` on its own head; the ruleset no longer requires the branch to be up to date
with `main`. The queue builds each entry on top of the current `main` plus the entries ahead of it,
runs this workflow for the `merge_group` event and merges only after that combined `CI Gate`
succeeds. Freshness is therefore proved once, by the queue, instead of by rebasing every open branch
after each merge. Add a ready pull request with the queue button or the GraphQL mutation
`enqueuePullRequest(input: {pullRequestId, expectedHeadOid})` through `gh api graphql`; merge
approval under `Owner gates` in `WORKFLOW.md` is unchanged. `gh pr merge` does not work here: it
queues a pull request only by enabling auto-merge, and auto-merge is off in this repository. Read
`isInMergeQueue` through `gh api graphql`, because `gh pr view --json` has no such field, and read
the outcome from `gh api repos/sachkov-inside/platform/pulls/<number> --jq '.merged, .merge_commit_sha'`.
A direct merge through the REST API answers `405 Changes must be made through the merge queue` even
for a clean pull request. The ruleset changes only by owner decision; an agent never edits it to get
a merge through.

`compose-production` checks the worker drain on whichever `material-assets.cleanup` job the worker
claims while the smoke holds the table lock. That job is not always the smoke's probe: the hourly
schedule can enqueue a cleanup job ahead of it (#728). The smoke log names both job ids and the
number of one-second checks the claim took; measured runs took 1–3 of the 20 allowed.

## Missing CI Gate recovery

On 07.10.2026, runs recorded in [#1085](https://github.com/sachkov-inside/platform/issues/1085)
finished with `failure` despite nine successful jobs and no created `CI Gate`. The same symptom
occurred on pull requests and `merge_group`; full reruns on unchanged SHAs created a successful
gate. Run `37642003271` used the same `ci.yml` Git blob as the inspected baseline, including
`always()` and all nine dependencies. These observations point to GitHub orchestration failure;
they do not establish its internal cause or a global incident.

`.github/workflows/ci-gate-recovery.yml` listens for completed **Application CI** runs through
`workflow_run`. It executes from the default branch with only `actions: write`, without checking
out candidate code, downloading artifacts or publishing checks. Recovery sends one full-rerun
request only when all of these conditions hold:

- The original workflow path is `.github/workflows/ci.yml`, the event is `pull_request` or
  `merge_group`, and the latest attempt is the first attempt, completed with `failure`.
- Its attempt-specific job list contains exactly the nine expected successful, completed jobs.
  `CI Gate` is absent. A failed, cancelled, skipped, unfinished or missing prerequisite prevents
  recovery; any created gate also prevents recovery.
- The Static job is named **Static checks (isolated reruns)**. This marks the workflow revision
  with separate rerun concurrency. Legacy workflows retain their original configuration on rerun
  and require manual recovery.
- No newer run was returned for the same workflow, event and branch, and a final read confirms
  that the original is still on its failed first attempt. The concurrency separation protects the
  newer first attempt even if it appears after these reads.

Release workflow calls are outside recovery. Subsequent attempts are not automatically recovered.
The rerun uses the original source revision and must produce the real required `CI Gate`; branch
protection is unchanged. An isolated rerun can continue checking an older SHA after a new commit,
so recovery can spend one additional full CI run without checking the latest candidate.

Read requests allow three retries for transient API errors. The rerun POST has no request retries:
an HTTP error can be ambiguous, and #1085 also records duplicate attempts after an accepted write.
A rejected request leaves the recovery workflow red. Inspect the original run's latest attempt
and active CI for that pull request before manually rerunning the recovery workflow. If the
original already advanced, do not request another full rerun. For a legacy workflow, inspect
active CI before using `gh run rerun <original-run-id>`; its old concurrency can cancel another run.
Persistent GitHub failure still requires operator intervention: GitHub must deliver the event and
accept the rerun request. Live automatic recovery of a provider incident was not exercised by
#1085's pull request; its tests execute the actual inline script with a substituted API.

`scripts/ci-gate-recovery.test.mjs` runs through `pnpm test:tooling` and `pnpm check`. It checks the
eligible symptom, ineligible job results, created gates, legacy names, later attempts, newer runs,
an original run changed before the write, and visible POST failure. The existing CI workflow
contract protects the separate rerun concurrency expression.

## Integration suites

Integration tests are split into two Vitest projects in `apps/backend/vitest.integration.config.mts`.
`integration` runs files in parallel against one PostgreSQL container shared by both projects; `createMigratedTestDatabase`
copies a template migrated once per run, while migration tests start from an empty database with
`createTestDatabase`. `integration-serial` holds the files that also own a RabbitMQ broker, kill
worker processes or write the machine-wide worker readiness file; they run one at a time, so they
measure behaviour rather than runner load. `scripts/integration-serial-files.test.mjs` fails when a
file that starts a RabbitMQ broker, forks a crash process or runs a worker is missing from that list.
PostgreSQL global setup starts its container only for the root project; child projects inherit
the setup but receive the root's provided database context without starting another container.
The full command and either `--project` selection
therefore start one PostgreSQL container, plus at most one RustFS or RabbitMQ container at a time,
and the Testcontainers Ryuk cleanup container. This bound describes one invocation; other sessions
own their own containers.

The root config caps file workers using `test/integration/setup/worker-budget.ts`: one worker per
two available CPU slots and per 2 GiB of available host memory, rounded down, with a minimum of one.
The smaller limit wins. Local runs additionally cap this budget at two file workers (#1151);
CI retains the resource-based budget. Each integration project names its worker limit; the serial
project sets one. The memory input is Node's `process.availableMemory()`: it accounts for Linux
cgroup memory limits; on macOS, it includes free, inactive and purgeable pages without applying a
process memory limit. The budget allows
1 GiB per active file and retains half the available memory and CPU slots for the runner, Docker
and another session. The #569 local baseline samples on 06.10.2026 reached 402 MiB per fork; 1 GiB also
allows room for PostgreSQL work. The topology bounds the number of containers; PostgreSQL CPU and
memory usage still depend on the number of active files.
This is a startup snapshot, not a reservation against later external load.
A machine with four available CPU slots and at least 4 GiB of available memory runs two files at once.
Explicit Vitest `--maxWorkers` overrides the automatic budget; `--no-file-parallelism` runs one file
at a time for comparison. The separate serial project retains its one-file limit.

The default test and hook budgets in the same config only stop a stuck run: a test that needs more
names its own budget, and a flaky test is fixed by its cause, never by raising a budget or re-running.

## Access checks

The access-check matrix `apps/backend/test/access-scenarios/access-check-matrix.ts` names, for each
Account state, action, surface and level, the test that proves it (#902). This table says where each
level runs:

| When | Checks | Job or command |
|---|---|---|
| Pull request, required | Matrix completeness: every cited file exists and declares `test(` or `it(` with the cited name; every production cell that cites the production pass has a pass cell `<row>@<transport>` in `apps/web/test/production/pass-config.ts` (`apps/backend/test/unit/access-check-matrix.test.ts`) | `unit` |
| Pull request, required | Production pass logic without network: request allowlist, cell verdict with deferred cells, report and secret redaction (`apps/web/test/module/production-access-*.test.ts`) | `unit` |
| Pull request, required | Facade on PostgreSQL in `apps/backend/test/integration`: `access-scenarios`, `payment-access-matrix`, `product-access`, `learning-practice`, `billing-operations`, `reading-activity`, `bookmarks`; real Nest HTTP: `scoped-access-http`, `billing-pricing-http`, `accounts-api`, `reading-activity-http`; real learner MCP transport: `scoped-learner-access-mcp` | `integration` |
| Pull request, required | Web/BFF owner billing scenario `apps/web/test/fullstack/enrollment.spec.ts` through `pnpm smoke:enrollments` | `integration` |
| Nightly | The other Web/BFF access scenarios the matrix cites: `material-reader`, `material-authoring`, `learning-practice` and `access-identities` in `apps/web/test/fullstack` | Nightly full-stack smoke |
| Before a release | `pnpm check:full`, which includes the full-stack smoke and the integration suite, on the release commit | local, see `AGENTS.md` |

| After a deploy or rollback | Production pass with test identities against production: the job `Production access pass` in `deploy.yml`, also run by hand through `workflow_dispatch` | [production release](production-release.md#проход-доступа-после-выпуска) |

A matrix cell at the `production` level is proved only by the production pass. The pass is a check
after a deploy, not a merge condition.

## Suites outside CI

These Playwright suites are deliberate manual proofs and do not run in CI:

| Suite | Why it is manual | How to run |
|---|---|---|
| `playwright.editor.config.ts` | needs the real editor, API and isolated PostgreSQL from `pnpm editor:local` | [local development](local-development.md) |
| `playwright.identity.config.ts` | needs the Logto identity stand; `pnpm identity:proof:hardening` runs `identity-proof.spec.ts`, and `telegram-sign-in.spec.ts` needs its own stand with the `inside-telegram` provider | [local development](local-development.md), [Telegram sign-in](../verification/telegram-sign-in-local.md) |

`scripts/playwright-specs-load.test.mjs` still loads every suite in `unit`, so a broken spec file
fails CI even when the suite itself is manual. Listing runs without `WEB_BASE_URL`,
`BACKEND_BASE_URL`, `LOGTO_ENDPOINT` and `IDENTITY_PROOF_MAILPIT_PORT`; missing settings never exempt
a configuration. The identity specs require their settings in `beforeAll`, at execution, and the
same tooling test checks that an absent or empty required setting fails with its name.

The host-process `pnpm smoke:fullstack` is intentionally not a per-pull-request job and not part of
`CI Gate`; it runs nightly instead (see below). Run `pnpm check:full` locally when a change can
affect the browser-to-host application path, or before a release candidate is selected.

## Nightly full-stack smoke

### Reader startup JavaScript budget

`keeps reader startup JavaScript within its CPU budget` in
`apps/web/test/fullstack/material-reader.spec.ts` checks the initial JavaScript execution of the
representative public Material, including its hydration and public shell. Both full-stack projects
run it: desktop Chromium at 1440 × 1024 and mobile Chromium at 390 × 844. Each test starts with a
fresh browser context on the production build, at native CPU speed without emulated throttling.

The budget is 200 ms of renderer-thread CPU time. CDP `Performance.enable` selects `threadTicks`;
the test subtracts the `ScriptDuration` counter before navigation from the next snapshot taken
after observing the reading action become `anonymous`. That browser-rendered state proves the
action is hydrated. The test separately checks that the captured `/auth/status` response is HTTP
200 with `state: "guest"` and `accountId: null`; an authentication failure cannot pass as readiness.
The test sends no input before measuring. Waiting for
HTTP responses and time when the renderer thread is not scheduled do not consume this budget.
The measured value and profile are logged and attached as `reader-startup-cpu` JSON in the
Playwright report, so successful nightly runs keep the measurement in their job log too.
A missing counter, unsupported thread clock or zero execution fails the test.

This is an initial JavaScript work budget, not an elapsed hydration deadline or an INP guarantee
for a particular device. It measures the `ScriptDuration` counter up to the second snapshot,
including any recorded script work between readiness and that snapshot.
`ScriptDuration` excludes nested layout and style recalculation; it can include compilation nested
in script execution. Separate compilation, layout and paint budgets are outside this check.
The existing representative-Material test still checks INP after readiness (#933). The startup
budget runs with the full-stack smoke, nightly and locally; it is outside the required PR CI gate.

`.github/workflows/nightly-fullstack.yml` runs `pnpm smoke:fullstack` on `main` every night at
01:17 UTC and on demand through `workflow_dispatch`. It is not a required check and never blocks a
merge. The job mirrors the documented host fallback on a clean `ubuntu-24.04` runner: frozen
install, Chromium, `cp .env.example .env`, `pnpm infra:up` for Compose PostgreSQL and Object
Storage, then the smoke with its own `inside_checks` database. The smoke job is read-only and reads
no repository or environment secrets. A separate failure-report job has `issues: write`; it uses
only `github.token`. A new run waits for the previous one on the same ref instead of overlapping it.

The smoke includes `apps/web/test/fullstack/access-identities.spec.ts` (#904). It signs in separate
identities through the real Web/BFF: a Materials-only Account, a Billing-only Account, a learner
whose only access is a tier scoped to one Product, and two ordinary Accounts. No pull-request job
runs these browser-path checks, so a release needs a green run of this workflow on the release
commit ([release](release.md#1-что-выпускаем)).

Where to look:

- Results: the Actions tab, workflow **Nightly full-stack smoke**, or
  `gh run list --workflow nightly-fullstack.yml`.
- A failed smoke job on `main` creates an Issue titled **Nightly full-stack smoke: падение на main**,
  labelled `needs-triage` and assigned to `KirillSachkov`. Further failures update its body with
  the latest run and source SHA. After fixing the cause, confirm a green run on `main` and close
  the Issue. Failed branch experiments do not create tracker notifications. A failed report job
  leaves the workflow red; it does not hide a denied GitHub write.
- On failure the run keeps Playwright traces and screenshots (`apps/web/test-results`,
  `apps/web/playwright-report`), the smoke's evidence snapshots, Compose service state and the
  latest 500 infrastructure log lines for seven days. `runner-load.txt` samples memory, runnable
  processes and CPU usage through `vmstat` every five seconds during the smoke. The job log
  contains the retained output of the API, MCP and web processes.
- Run it by hand for a branch: `gh workflow run nightly-fullstack.yml --ref <branch>`.

A red nightly run requires diagnosis. An MCP validation error names the rejected tool and nested
field; check the probe against that tool's contract. An unavailable page alone does not prove a
contract mismatch: inspect the Playwright trace, API/Web output and load samples. Locate the
source of a `TimeoutError` in its stack: server-side fetch and Playwright actions have different
budgets. Load samples help investigate its cause, but do not prove it.
Do not increase budgets or retry tests to get a green run. For a branch failure, open or reopen a
Platform issue when diagnosis finds a defect.

The [#589 evidence](../evidence/issue-589/README.md) records measured CI cost, the mechanism choice
and the inventory of probes outside the pull-request gate.

## Nightly flake hunt

`.github/workflows/nightly-flake-hunt.yml` samples `main` daily at 02:43 UTC and supports
`workflow_dispatch`. It is outside `CI Gate`. Each suite runs five times independently, including
after a failed sample; Playwright and Vitest retries are explicitly zero. A failed sample keeps
the matrix job red even when the next four pass. This is detection, not recovery of a failed gate.

The matrix covers Web E2E and navigation on one production build, Storybook, browser-engines,
both backend integration projects, and the unit and local contract commands from `check:unit`: backend, Web module,
Telegram, legal, access-capabilities, Node tooling, authoring, practice-review, backend/Web contracts and release/deploy shell contracts. It does not repeat
build/static checks, live production probes, or the separate nightly full-stack smoke.

Each matrix job uploads `flake-<suite>-<run_attempt>` for seven days, including successful samples.
Each command and iteration has its own JSON reporter output, normalized observations, exit status
and log. Web E2E/navigation retain failed traces, screenshots and the existing per-test videos.
Storybook retains failed browser traces and screenshots; browser-engines copies its existing
diagnostics before the next invocation can replace them. A setup error or absent/malformed report
keeps the job red; missing samples never count as passes. The job summary shows observed failures
over executed samples and skipped samples for each test identity (suite, file, command/project and
full name). Playwright includes its real project name. Vitest's JSON reporter omits project names,
so its identity uses the command selecting the tests. Integration and integration-serial run
separately through their owning package scripts and remain separate in the table and Issues.
When parameterized cases have identical full names, the report keeps the full name and adds a
case index within that file/name group. Vitest JSON retains declaration order; Node observations
are sorted by testId. Unrelated tests do not affect this index. Reordering identically named cases
or removing duplicate names can change their identity; give cases distinct names to avoid that limit.
The unit-job inventory comes from the workspace package manifests, root Node test scripts and
the `check:contracts` aggregate,
the same sources `check:unit` uses; unsupported new command syntax fails visibly.

Only the reporting job has `issues: write`. It runs exclusively for schedule/manual runs on `main`,
checks out that run's trusted main SHA and downloads data artifacts from the same run. Branch
experiments execute with read-only permissions and do not create Issues. A test that fails at least
once creates a `needs-triage` Issue with its failure fraction, SHA, attempt and artifact link.
Further failures update the open Issue identified by its stable body marker, even if its label or
title changed. A denied GitHub write fails the reporting job. After fixing the cause, confirm a
green run on `main` and close the Issue; a 100% failure fraction may indicate a permanent defect.

Cost and duration are bounded by the matrix timeouts, not measured production baselines yet:

| Suite | Runner-minute ceiling per scheduled run, including setup |
|---|---:|
| Web E2E and navigation | 90 |
| Storybook | 60 |
| Browser-engines | 60 |
| Integration | 120 |
| Unit | 90 |
| Reporting | 5 |
| Total | 425 |

At most two test jobs run together. The sum above is also a conservative wall-time ceiling after
runner allocation, excluding GitHub queue time. For 30 scheduled days the ceiling is 12,750 Linux
runner-minutes; manual runs and reruns add to it. Actual billed cost depends on the repository's
GitHub Actions allowance and Linux runner rate; multiply billable minutes by that rate. Artifacts
also consume storage for seven days. Record actual job durations from the first green scheduled
run before budgeting against an average; the timeout ceilings are not expected consumption.

For a quick reporting exercise, dispatch with `fixture=true`. Only the deliberately alternating
fixture runs, with three failures out of five and no retries. Its test job is intentionally red.
On `main`, the report creates one fixture Issue; a second dispatch updates it. Close the exercise
Issue after confirming the artifact links and both run URLs. The fixture mode has a 15 runner-minute
ceiling (10 for samples, five for reporting), and never modifies a production test.

```bash
gh workflow run nightly-flake-hunt.yml --ref main -f fixture=true
gh run list --workflow nightly-flake-hunt.yml
```

The local executable fixture/CLI tests use a substituted GitHub client to prove creation, updates
and denied-write handling without tracker pollution. The full five-suite workflow must be verified
by an Actions run; these local tests do not claim that all browser/container suites passed.

## Diagnostics and cleanup

PR CI and the nightly full-stack smoke upload Playwright traces, screenshots and HTML reports
only after a failure. The flake hunt retains every sample as described above. Compose jobs
capture service state and at most the latest 500 log lines before cleanup. Diagnostic artifacts are
retained for seven days; successful PR CI and full-stack smoke runs store none of them.

The Telegram reminder test in `apps/web/test/e2e/account-cabinet.spec.ts` (#999) and
`unlinked Account sees centered onboarding once per authenticated session` in
`apps/web/test/e2e/routes.spec.ts` (#1080) also retain a video on failure. Web E2E uploads
`playwright-report` (including the error's call log) and
`test-results` (including `trace.zip` and the video) as `web-e2e-playwright-<run_attempt>`.
Each CI attempt has its own artifact name, so a rerun does not replace the earlier failure.
For a stuck reopen, inspect the reminder click after closing the dialog in the trace, its call
log, and the video. Download the artifact before its seven-day retention expires.
For a stuck onboarding reload, inspect the failing `page.reload` call and its pending navigation
event in the trace. Check the document and unfinished resource requests, the `/auth/status` and
`/api/account` responses, and the video around the reload. Copy local `test-results` and
`playwright-report` before another Playwright invocation replaces them. Attach the run URL,
attempt number, head SHA and downloaded artifact to #1080; it remains open until a captured
natural failure establishes the cause.

The narrow WebKit Telegram geometry test also saves `failure.json` with its pending step, last
completed step, viewport width and completed step durations (#1110). It exports a Playwright trace
for each viewport reached before the failure, including test timeouts. The phase file also records
the pending step's start and failure observation on one monotonic clock, plus initial/failure
runner CPU counters, load and memory, worker CPU/memory usage, and
best-effort Linux `/proc` and cgroup readings. Missing Linux readings carry their errors rather
than suppressing the other diagnostics. `webkit-log.json` retains `pw:browser` (including browser
stderr) and `pw:protocol` output only from the geometry scenario. Collection stops when the test
finishes, before asynchronous failure cleanup. The collector uses Playwright
1.63.0's exported `utilsBundle.debug` instance; its runtime shape and real browser output are
checked by `webkit-failure-diagnostics.test.ts`. The log keeps up to 2 MiB of initial messages and
2 MiB of final messages; it reports omitted entries. A failure before the first trace starts
still retains the phase file and browser log. The UI job uploads these files as
`browser-engines-playwright-<run_attempt>`; a successful test removes its diagnostic directory.
The test keeps its 30-second budget and does not retry. Inspect the pending step before choosing
a fix; #1110 remains open until a captured failure establishes the cause.

The full-stack scenario `Billing-only opens billing tools and is denied a Materials mutation
without a durable effect` (#1136) retains video of the Billing-only context, including the
first-sign-in helper's page that closes before the scenario continues. The full-stack configuration
also writes an HTML report with the error's call log. The nightly job uploads it and `test-results`
as `nightly-fullstack-diagnostics-<run_attempt>` for seven days. Copy local `test-results` and
`playwright-report` before another invocation replaces them. At a first-sign-in timeout, inspect
the WelcomeDialog contents in the trace and video: the original #1135 trace showed the terms
unavailable alert, with no acceptance button. Compare the welcome request time with API/MCP
restart and readiness logs; that original run also recorded a generated Prisma client change and
process restart. This timing does not establish the cause of the unavailable terms response.
Attach the run URL, attempt, head SHA and artifacts to #1136; keep it open until a captured failure
establishes the cause.

Every Compose job owns an isolated project on its runner and removes containers, networks and
volumes even after a failed command. The production smoke additionally removes locally built
images. It embeds a synthetic release identity, supplies the exact local image IDs to production
Compose, and proves fresh/upgrade/N-1 migrations, `pg-boss` resume, release/schema readiness,
worker drain/no-overlap, TLS and positive/negative routes without application or provider writes.
Pull-request CI does not publish packages, use GHCR permissions, deploy to a server or read
production configuration. `.github/workflows/release.yml` calls CI with read-only contents access,
then publishes packages in a separately permissioned matrix job. The reusable release call skips
the release-image smoke already proved by pull-request CI, so its publish job builds each candidate
image only once. Release finalization receives only non-secret image identity artifacts from the
current run.

The executable workflow contract lives in `scripts/ci-workflow-contract.test.mjs` and runs through
`pnpm test:tooling` and therefore `pnpm check`. It protects triggers (including `merge_group`),
permissions, action pinning in the workflow and the setup action, the one-job-per-`check:*`-stage
mapping, job dependencies and artifact retention from configuration drift, for both the pull-request
workflow and the nightly full-stack workflow.

The release, deployment and manifest policies have executable contracts in
`scripts/release-workflow-contract.test.mjs`, `scripts/contracts/deployment-workflow-contract.test.mjs`,
`scripts/contracts/release-image-contract.test.mjs`, `scripts/contracts/release-contract.test.mjs`,
`scripts/contracts/release-rollback-proof.test.mjs` and the production deployment tests. Fixtures cover
next/duplicate/stale ordinals,
bare/mutable/discontinuous retained history and mismatched image results. The workflow contract
checks the least-privilege boundary against both the release workflow and one over-privileged
negative fixture.

Independent Telegram publication and deployment use root `telegram-release.yml` and
`telegram-deploy.yml`. Their owning [production runbook](../../apps/telegram/docs/operations/production.md)
defines the two trusted source families, environment and rollback contract.
