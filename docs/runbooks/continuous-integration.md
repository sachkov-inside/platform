# Continuous integration

Platform pull requests into `main` are protected by `.github/workflows/ci.yml`. The workflow has
read-only repository access, does not read repository or environment secrets and runs only on
GitHub-hosted `ubuntu-24.04` runners. A new commit cancels an older run for the same pull request.

The workflow is also callable through `workflow_call`. The ordinal release workflow invokes this
same contract with its captured, exact source SHA before it publishes images. Every checkout in the
reusable path uses that SHA, so a moving branch cannot change the candidate during CI. Direct
pushes do not start application CI; the protected `main` branch accepts changes only through a
current pull request with a successful `CI Gate`.

## Required checks

Four jobs run independently so a failure identifies its owning verification seam:

| Job | Repository command or proof |
|---|---|
| `quality` | frozen install, Chromium and `pnpm check` |
| `integration` | `pnpm test:integration` with Testcontainers-owned PostgreSQL and MinIO |
| `compose-development` | profile config/build, live smoke, restart persistence and clean shutdown |
| `compose-production` | isolated seven-process digest-selected runtime proof; pull requests also run clean `pnpm release:images:smoke` |

`CI Gate` depends on all four jobs and succeeds only when every result is `success`. The repository
ruleset requires this exact check name and strict synchronization with `main`; individual job names
may evolve without changing the branch-protection interface.

The host-process `pnpm smoke:fullstack` is intentionally a local verification seam rather than a
per-pull-request job. Run `pnpm check:full` locally when a change can affect the browser-to-host
application path, or before a release candidate is selected.

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
`pnpm test:tooling` and therefore `pnpm check`. It protects triggers, permissions, action pinning,
commands, job dependencies and artifact retention from configuration drift.

The release workflow and manifest policy have their own executable contracts in
`scripts/release-workflow-contract.test.mjs`, `scripts/release-image-contract.test.mjs` and
`scripts/release-contract.test.mjs`. Fixtures cover next/duplicate/stale ordinals,
bare/mutable/discontinuous retained history and mismatched image results. The workflow contract
checks the least-privilege boundary against both the release workflow and one over-privileged
negative fixture.
