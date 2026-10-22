# Repository verification

Local repository checks, issue evidence and integration tests.

## Repository verification

With pinned host Node.js and pnpm:

```bash
pnpm check
```

This covers formatting, lint, strict typecheck, backend architecture guardrails,
unit/module/local contract/Storybook tests, Playwright, production builds and the Storybook build without
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

Several Storybook test runs may overlap in one checkout: `pnpm test:storybook`, the Storybook stage
of `pnpm check` and the test run that `pnpm storybook` starts from its panel or MCP. The Vitest
process of the `storybook` project keeps its own Vite dependency cache in `$TMPDIR` and deletes it
on exit (`apps/web/test/support/run-scoped-vite-cache.mjs`). The cache that `storybookTest` shares
across a checkout broke such runs: Vite rebuilds it in place when a run has another configuration
hash, and Storybook's own runner has `NODE_ENV=development` where the CLI has `test`. The other
run's browser then failed to load the replaced files, and its stories printed `(0 test)` (#1004).
The shared cache saved no time: on 07.10.2026 two runs of `pnpm test:storybook` with an empty cache
took 16.6 and 19.0 s by the Vitest `Duration` line, and two runs with a full cache took 17.1 and
18.8 s.

Storybook import failures retain primary evidence in
`apps/web/test-results/storybook-imports/run-<pid>-<process-start>/imports.jsonl`. The Node-side provider observes
failed script HTTP responses and transport failures before any setup import. Vite records the
original error response body and server error, even when Chromium discards the failed body.
Premature response closure retains the partial body with `complete: false`; browser transport
errors retain an already observed HTTP status. Server messages and stacks identify truncation too.
No request is replayed. Successful script responses are not recorded. Each process retains up to
1 MiB of events, with at most 64 KiB per response body; truncation is explicit. Logs retain the
request path and Vite cache/import query values, but omit arbitrary URL query values and authentication headers.
Error bodies and server messages can contain local source, so inspect them before sharing.
The UI CI job uploads this directory with browser-engine diagnostics on failure for seven days.
A later successful run does not establish the cause of an earlier import failure (#1429).

Vitest opens every story file in a new iframe and loads its modules again from the Vite server of
the run. Storybook loads two large modules lazily: the React renderer imports
`@storybook/react-dom-shim` with `react-dom/client` (3.1 MB) on the first render, and `addon-a11y`
imports `axe-core` (4 MB) on the first accessibility check. The setup file
`apps/web/test/support/storybook-preload.ts` loads both before the tests of each file, so the
15-second budget of a story measures the story itself. Without it, the first story of a file paid
for that load. When parallel heavy checks slowed the Vite server, the load alone took several
seconds, and first stories exceeded the budget (#1095, #1128). The preload does not make the run
shorter: a slow Vite server now shows in the `setup` and `import` times of the Vitest `Duration`
line, not as a failed story. The pinned versions of `axe-core` and `@storybook/react-dom-shim` in
`apps/web/package.json` must match the versions that `addon-a11y` and Storybook use; update them
together. `apps/web/test/module/storybook-preload.test.ts` fails when they differ or when the
`storybook` project loses the setup file.

The pinned `@storybook/addon-vitest@10.6.1` has a local pnpm patch (#1023). Its Execa child
process disables `ipcOutput` buffering: live listeners already consume every message, while the
buffer kept all successive full test-state snapshots until Vitest exited. A full MCP `test-run`
therefore exhausted the Storybook heap after the tests had passed. The patch also makes Vitest exit
when its IPC connection closes, including a parent's OOM abort or SIGKILL. Test results and a11y
reports remain complete; the heap limit is unchanged. `scripts/storybook-runner.test.mjs` exercises
the installed addon's launch options and disconnect handler. Remove the patch only when an upstream
version passes both regression cases and the full MCP run. Every Docker dependency stage copies
`patches/` before the workspace's frozen install.

The pinned `@vitest/browser-playwright@4.1.11` also has a local pnpm patch (#1160).
Its trace command leaves the internal chunk name to Playwright: story names such as `Mobile`
repeat across files, while the browser's contexts share one temporary trace directory. Passing
that repeated name mixed the files and could fail `tracing.stopChunk` while it built an archive.
The final archive paths and trace titles keep their readable story names.
`apps/web/test/browser-engines/vitest-tracing.test.ts` creates two real Chromium contexts,
starts their chunks with the installed Vitest command and checks that each archive contains
only its own file's marker.
The fixture uses `unzip`, available on the macOS development host and Ubuntu CI runner.
Remove the patch when the upstream provider passes this regression without it.

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
go to the artifacts directory. Review the result and commit it with the work it belongs to. A
misspelled folder fails the run instead of quietly writing nowhere you would look.

`UPDATE_EVIDENCE` chooses the destination, not whether a snapshot is taken. Some suites still take
theirs only behind their own switch: `CAPTURE_EVIDENCE=1` for the authoring walkthroughs,
`CAPTURE_TELEGRAM_EVIDENCE=1` for the Telegram sign-in states, and the per-issue
`CAPTURE_ISSUE_NNN_EVIDENCE=1` used by the Reader scenarios. Set both when you want a fresh
snapshot committed.

`pnpm evidence:web` selects `evidence.spec.ts` for desktop and mobile Chromium. It uses the same
production launcher as `test:e2e`, with test Logto settings, a temporary release identity and the
`/_health/live` readiness probe. `PLAYWRIGHT_BACKEND_BASE_URL` selects the backend;
`EVIDENCE_STORAGE_STATE` supplies the browser session for authenticated evidence.

`scripts/evidence-path.mjs` owns this rule, and `scripts/evidence-path.test.mjs` keeps it honest.
Evidence that a run reads rather than writes stays in the tree: the Storybook cover fixtures come
from `docs/evidence/issue-271/covers`.

Run only the real-PostgreSQL backend suite with:

```bash
pnpm test:integration
```

Its disposable Testcontainers database covers create/load/Save, mutable current Materials,
rollback and constraints, idempotency, concurrent stale writes, migration replay and Prisma schema
mapping.
