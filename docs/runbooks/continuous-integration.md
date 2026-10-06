# Continuous integration

Platform pull requests into `main` are protected by `.github/workflows/ci.yml`. The workflow has
read-only repository access, does not read repository or environment secrets and runs only on
GitHub-hosted `ubuntu-24.04` runners. A new commit cancels an older run for the same pull request.
The same workflow runs for the `main` merge queue (`merge_group`).

The workflow is also callable through `workflow_call`. Both ordinal release workflows (`release.yml` and `telegram-release.yml`) invoke this
same contract with its captured, exact source SHA before it publishes images. Every checkout in the
reusable path uses that SHA, so a moving branch cannot change the candidate during CI. Direct
pushes do not start application CI; the protected `main` branch accepts changes only through the
merge queue with a successful `CI Gate`.

Changes under `contracts/workshop/`, `tools/workshop-evaluator/` or their workflow also start the
read-only `.github/workflows/workshop-evaluator.yml`. Its matrix uses native GitHub-hosted
`macos-15` arm64, `ubuntu-24.04` amd64 and `windows-2025` amd64 runners. Each host checks the shared
embedded schemas, runs Go unit/integration/race tests, builds the pinned CLI, executes the complete
synthetic device/report smoke as a native process, verifies an exact SHA-256 checksum and uploads
a `tar.gz` package plus its exact checksum for 14 days. The package keeps the native binary, its
checksum and native wrapper together while preserving Unix executable modes. Linux and Windows run
the real Compose smoke in CI; GitHub-hosted macOS arm64 runs the native fake-Docker smoke because
the hosted runner cannot provide nested virtualization, while release evidence records the real
Compose smoke from a physical macOS arm64 host. The workflow does not use credentials, create a
GitHub Release or provide an auto-update channel.

## Required checks

`pnpm check` is the aggregate of four stages, and each stage runs as its own job, so a failure
names its seam and the stages run in parallel:

| Job | Repository command or proof |
|---|---|
| `static` | `pnpm check:static`: documentation contract, Prettier formatting, workspace packages and Prisma client, OpenAPI drift, lint, typecheck, guardrails |
| `unit` | `pnpm check:unit`: tooling and authoring `node --test`, Workshop contracts and `go test -race`, backend and package Vitest, web module tests |
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

`CI Gate` depends on every job and succeeds only when every result is `success`. The repository
ruleset requires this exact check name; individual job names may evolve without changing the
branch-protection interface.

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
The smaller limit wins. The memory input is Node's `process.availableMemory()`: it accounts for Linux
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
| Pull request, required | Facade on PostgreSQL in `apps/backend/test/integration`: `access-scenarios`, `payment-access-matrix`, `guide-access`, `learning-practice`, `billing-operations`, `reading-activity`, `bookmarks`; real Nest HTTP: `scoped-access-http`, `billing-pricing-http`, `accounts-api`, `reading-activity-http`; real learner MCP transport: `scoped-learner-access-mcp` | `integration` |
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

`.github/workflows/nightly-fullstack.yml` runs `pnpm smoke:fullstack` on `main` every night at
01:17 UTC and on demand through `workflow_dispatch`. It is not a required check and never blocks a
merge. The job mirrors the documented host fallback on a clean `ubuntu-24.04` runner: frozen
install, Chromium, `cp .env.example .env`, `pnpm infra:up` for Compose PostgreSQL and Object
Storage, then the smoke with its own `inside_checks` database. The smoke job is read-only and reads
no repository or environment secrets. A separate failure-report job has `issues: write`; it uses
only `github.token`. A new run waits for the previous one on the same ref instead of overlapping it.

The smoke includes `apps/web/test/fullstack/access-identities.spec.ts` (#904). It signs in separate
identities through the real Web/BFF: a Materials-only Account, a Billing-only Account, a learner
whose only access is a tier scoped to one Guide, and two ordinary Accounts. No pull-request job
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

## Diagnostics and cleanup

Playwright traces, screenshots and HTML reports are uploaded only after a failure. Compose jobs
capture service state and at most the latest 500 log lines before cleanup. Diagnostic artifacts are
retained for seven days; successful runs store none of them.

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

The Workshop artifact matrix has a separate executable contract in
`scripts/workshop-evaluator-workflow.test.mjs`. Cross-language schema agreement also runs locally
through `pnpm workshop:contracts:check`; generated Go schema drift and bounded lifecycle behavior
run through `pnpm workshop:evaluator:test`.

The release, deployment and manifest policies have executable contracts in
`scripts/release-workflow-contract.test.mjs`, `scripts/deployment-workflow-contract.test.mjs`,
`scripts/release-image-contract.test.mjs`, `scripts/release-contract.test.mjs`,
`scripts/release-rollback-proof.test.mjs` and the production deployment tests. Fixtures cover
next/duplicate/stale ordinals,
bare/mutable/discontinuous retained history and mismatched image results. The workflow contract
checks the least-privilege boundary against both the release workflow and one over-privileged
negative fixture.

Independent Telegram publication and deployment use root `telegram-release.yml` and
`telegram-deploy.yml`. Their owning [production runbook](../../apps/telegram/docs/operations/production.md)
defines the two trusted source families, environment and rollback contract.
