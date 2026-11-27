# Repository verification

Local repository checks, issue evidence and integration tests.

## Repository verification

With pinned host Node.js and pnpm:

```bash
pnpm check
```

Root AGENTS.md → Commands decides which checks verify a task; the commands here reproduce or
diagnose a CI stage locally.

Repository launchers preserve the pinned pnpm CLI from `npm_execpath`: pnpm 12 runs as a native
executable, while JavaScript CLI entrypoints run through the selected Node.js.

This covers formatting, lint, strict typecheck, backend architecture guardrails,
unit, module, local contract and Playwright tests, and production builds without
claiming a real database. It runs the four stages `pnpm check:static`, `check:unit`, `check:ui` and
`check:web-e2e` in order; CI runs each stage as its own job, so run the one stage that matches a CI
failure to reproduce it. Local contracts have separate selections under
[`pnpm check:contracts`](continuous-integration.md#local-contract-tests). A failed `pnpm format:check` is fixed by `pnpm format`; `.prettierignore`
names the generated, pinned and managed files that keep their own bytes. `.git-blame-ignore-revs`
lists the mechanical formatting commits; run `git config blame.ignoreRevsFile .git-blame-ignore-revs`
once per clone so local `git blame` skips them, as GitHub does.

A full run takes about ten minutes. `check:static` rebuilds the `packages/*/dist` that later stages
import, so leave the tree alone while it runs: an edit or package rebuild in the middle fails an
unrelated test.

The inline SVG browser contract retains its unfinished phase, completed-step durations and resource
snapshot in `apps/web/test-results/browser-engines/inline-svg/<engine>/failure.json`. WebKit also
retains a bounded protocol/browser log in `webkit-log.json`. The failure hook runs after cleanup,
so a timeout in `browser.close()` gets diagnostics too. The existing UI failure artifact
`browser-engines-playwright-<attempt>` includes this directory. Download it before another local run,
which clears this test's previous output. These files contain the test's synthetic SVG fixture;
they do not observe an authenticated application session.

Page transitions are checked on a production build, because development mode has no link prefetch
and no route cache:

```bash
pnpm --filter @inside/web test:navigation
```

The suite builds web and starts it with `next start` (`apps/web/test/support/production-web.mjs`,
shared with `test:e2e`) next to a fake backend from
`apps/web/test/navigation/fake-backend.mjs`; [ADR 0027](../adr/0027-web-navigation-and-caching.md)
lists what it proves. It takes free ports unless `NAVIGATION_WEB_PORT` and `FAKE_BACKEND_PORT` set
them. Each run writes its timings and transition snapshots as evidence of issue
#670 under the rule in [Snapshots as issue evidence](#snapshots-as-issue-evidence). `pnpm check`
runs the suite through root `pnpm test:navigation`, which reuses the production build the check
has just made, right after `test:prerendered-handlers` has confirmed that the build prerendered no
Route Handler. Root `pnpm test:e2e` reuses the same build (`PRODUCTION_WEB_SKIP_BUILD=1`); the
package-level `pnpm --filter @inside/web test:e2e` builds first.

```bash
pnpm check:full
```

This adds isolated Testcontainers integration tests and the host full-stack smoke. The host smoke
owns ports 3000, 3001 and 3002 by default. When this session owns the stack, stop it and start only
`pnpm infra:up`. When the owner or another session owns the stand, keep it running and use a disposable Compose
project with different `POSTGRES_HOST_PORT`, `OBJECT_STORAGE_HOST_PORT` and
`OBJECT_STORAGE_CONSOLE_HOST_PORT`. Start only that project's `postgres` and `object-storage`.
Set free `API_PORT`, `FULLSTACK_WEB_PORT` and `FULLSTACK_MCP_PORT` for the host smoke, plus
`OBJECT_STORAGE_ENDPOINT` and `OBJECT_STORAGE_SIGNED_GET_ENDPOINT` for its storage port.
Keep the disposable project's `COMPOSE_PROJECT_NAME` and port variables exported through
`pnpm check:full` and its final `docker compose down --volumes`. Without an explicit
`DATABASE_URL`, `scripts/check-database.mjs` resets only `inside_checks` in the selected project's
PostgreSQL. Do not export the owner's database URL. The host smoke rejects a running API with
a production release identity instead of treating another stand as its own.
For release candidates, use the [verification evidence policy](../agents/release-evidence.md).
This host-process smoke fills missing release coverage or diagnoses failures. PR pushes, including
drafts, run automatically selected affected checks. The merge queue runs complete coverage for every affected application, including full-stack
for Platform; shared or unknown inputs cover both applications. See [Continuous integration](continuous-integration.md) for the selected plan,
CI Gate and failure diagnostics. Scheduled full-stack runs are removed; the manual full-stack
workflow remains available for investigation.

`FULLSTACK_TEST_GREP='<test title>'` limits the host full-stack smoke to matching tests. After
`@playwright/test` changes version, install its browsers on the host before a run with
`pnpm --filter @inside/web exec playwright install chromium chromium-headless-shell`; `pnpm check`
also runs the WebKit browser-engine checks, which fail with `Executable doesn't exist` until `webkit`
is installed the same way. A manual full-stack investigation on the baseline source can show
whether a failing test also fails without your change. On macOS a
sleeping Mac stalls a long host suite for minutes and fails it with `net::ERR_NETWORK_IO_SUSPENDED`,
which is not a product defect; the #745 run passed under `caffeinate -i`.

### Snapshots as issue evidence

A run takes screenshots for every scenario it walks, not only for the issue you are working on. By
default they go to `ci-artifacts/evidence/<issue folder>/`, which Git ignores, so an ordinary local
run leaves `git status` clean and never overwrites the evidence another issue committed.

Update the evidence of your own issue explicitly:

```bash
UPDATE_EVIDENCE=issue-529 pnpm smoke:fullstack
```

Only `docs/evidence/issue-529` is written; snapshots of every other scenario in the same run still
go to the artifacts directory. A misspelled folder fails the run instead of quietly writing nowhere
you would look. Commit a snapshot only when a run reads it. Evidence for the owner is attached to
the PR under [PR body](../agents/pr.md#attachments), and
[human participation](../agents/human-review.md#evidence) owns what counts as evidence; earlier
committed evidence stays as it is.

`UPDATE_EVIDENCE` chooses the destination, not whether a snapshot is taken. Some suites still take
theirs only behind their own switch: `CAPTURE_EVIDENCE=1` for the authoring walkthroughs,
`CAPTURE_TELEGRAM_EVIDENCE=1` for the Telegram sign-in states, and the per-issue
`CAPTURE_ISSUE_NNN_EVIDENCE=1` used by the Reader scenarios. Set both when you want a fresh
snapshot in the chosen folder.

`pnpm evidence:web` selects `evidence.spec.ts` for desktop and mobile Chromium. It uses the same
production launcher as `test:e2e`, with test Logto settings, a temporary release identity and the
`/_health/live` readiness probe. `PLAYWRIGHT_BACKEND_BASE_URL` selects the backend;
`EVIDENCE_STORAGE_STATE` supplies the browser session for authenticated evidence.

`scripts/evidence-path.mjs` owns this rule, and `scripts/evidence-path.test.mjs` keeps it honest.

Run only the real-PostgreSQL backend suite with:

```bash
pnpm test:integration
```

Its disposable Testcontainers database covers create/load/Save, mutable current Materials,
rollback and constraints, idempotency, concurrent stale writes, migration replay and Prisma schema
mapping.
