# Continuous integration

Platform pull requests into `main` are protected by `.github/workflows/ci.yml`. The workflow has
read-only repository access, does not read repository or environment secrets and runs only on
GitHub-hosted `ubuntu-24.04` runners. A new commit cancels an older run for the same pull request.
The same workflow runs for the `main` merge queue (`merge_group`).

The workflow is also callable through `workflow_call`. The ordinal release workflow invokes this
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
| `static` | `inside-harness health` at the installed harness version, then `pnpm check:static`: documentation contract, workspace packages, OpenAPI drift, lint, typecheck, guardrails |
| `unit` | `pnpm check:unit`: tooling and authoring `node --test`, Workshop contracts and `go test -race`, backend and package Vitest, web module tests |
| `ui` | `pnpm check:ui`: browser-engine checks (Chromium and WebKit), Storybook tests and the Storybook build |
| `web-e2e` | `pnpm check:web-e2e`: one production build, prerendered and standalone checks, then Playwright e2e and page transitions on `next start` of that build |
| `integration` | `pnpm test:integration:parallel` (PostgreSQL and RustFS via Testcontainers, a migrated template database copied per test database), then `pnpm smoke:enrollments` |
| `integration-serial` | `pnpm test:integration:serial`: RabbitMQ, SIGKILL crash and worker-process files, one file at a time |
| `compose-development` | profile config/build, live smoke, restart persistence and clean shutdown |
| `compose-production` | isolated nine-process digest-selected runtime proof with the environment broker; pull requests also run clean `pnpm release:images:smoke` |

`.github/actions/setup-platform` owns the shared setup: pinned pnpm and Node.js, the frozen
install and, on request, Playwright browser engines restored from a cache keyed by the exact
Playwright version. The harness check reads the version from `.inside-harness/product-harness.json`
and clones the matching `inside-engineering-v<version>` tag of the public Workspace repository, so a
newer Workspace release cannot fail an unchanged Platform branch.

`CI Gate` depends on every job and succeeds only when every result is `success`. The repository
ruleset requires this exact check name; individual job names may evolve without changing the
branch-protection interface.

## Merge queue

`main` merges through the GitHub merge queue (owner decision of 2026-09-24). A pull request needs a
successful `CI Gate` on its own head; the ruleset no longer requires the branch to be up to date
with `main`. The queue builds each entry on top of the current `main` plus the entries ahead of it,
runs this workflow for the `merge_group` event and merges only after that combined `CI Gate`
succeeds. Freshness is therefore proved once, by the queue, instead of by rebasing every open branch
after each merge. Add a ready pull request with `gh pr merge <number> --squash` (or the queue button);
merge approval under `Owner gates` in `WORKFLOW.md` is unchanged. A direct merge through the REST API
answers `405 Changes must be made through the merge queue` even for a clean pull request. The
ruleset changes only by owner decision; an agent never edits it to get a merge through.

The workflow runs on `pull_request`, so a pull request whose `mergeable` state is `CONFLICTING`
starts no checks at all. When no check appears after a push, read
`gh pr view <number> --json mergeable,mergeStateStatus` first, then integrate `origin/main` as
`WORKFLOW.md` describes and push.

## Integration suites

Integration tests are split into two Vitest projects in `apps/backend/vitest.integration.config.mts`.
`integration` runs files in parallel against one PostgreSQL container; `createMigratedTestDatabase`
copies a template migrated once per run, while migration tests start from an empty database with
`createTestDatabase`. `integration-serial` holds the files that also own a RabbitMQ broker, kill
worker processes or write the machine-wide worker readiness file; they run one at a time, so they
measure behaviour rather than runner load. `scripts/integration-serial-files.test.mjs` fails when a
file that starts a RabbitMQ broker, forks a crash process or runs a worker is missing from that list.
The default test and hook budgets in the same config only stop a stuck run: a test that needs more
names its own budget, and a flaky test is fixed by its cause, never by raising a budget or re-running.

## Suites outside CI

These Playwright suites are deliberate manual proofs and do not run in CI:

| Suite | Why it is manual | How to run |
|---|---|---|
| `playwright.editor.config.ts` | needs the real editor, API and isolated PostgreSQL from `pnpm editor:local` | [local development](local-development.md) |
| `playwright.reading-proof.config.ts` | issue #328 screenshot evidence against a running Storybook; its stories and accessibility run in `ui` | `docs/evidence/issue-328/README.md` |
| `playwright.identity.config.ts` | needs the Logto identity stand; run by `pnpm identity:proof:hardening` | [local development](local-development.md) |

`scripts/playwright-specs-load.test.mjs` still loads every suite in `unit`, so a broken spec file
fails CI even when the suite itself is manual.

The host-process `pnpm smoke:fullstack` is intentionally not a per-pull-request job and not part of
`CI Gate`; it runs nightly instead (see below). Run `pnpm check:full` locally when a change can
affect the browser-to-host application path, or before a release candidate is selected.

## Nightly full-stack smoke

`.github/workflows/nightly-fullstack.yml` runs `pnpm smoke:fullstack` on `main` every night at
01:17 UTC and on demand through `workflow_dispatch`. It is not a required check and never blocks a
merge. The job mirrors the documented host fallback on a clean `ubuntu-24.04` runner: frozen
install, Chromium, `cp .env.example .env`, `pnpm infra:up` for Compose PostgreSQL and Object
Storage, then the smoke with its own `inside_checks` database. The workflow is read-only, reads no
secrets, and a new run waits for the previous one on the same ref instead of overlapping it.

Where to look:

- Results: the Actions tab, workflow **Nightly full-stack smoke**, or
  `gh run list --workflow nightly-fullstack.yml`. GitHub e-mails a failed scheduled run to the
  person who last changed its `cron`.
- On failure the run keeps Playwright traces and screenshots (`apps/web/test-results`,
  `apps/web/playwright-report`), the smoke's evidence snapshots, Compose service state and the
  latest 500 infrastructure log lines for seven days. The job log contains the retained output of
  the API, MCP and web processes.
- Run it by hand for a branch: `gh workflow run nightly-fullstack.yml --ref <branch>`.

A red nightly run is a product or smoke defect: open or reopen a Platform issue with the run link.

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
