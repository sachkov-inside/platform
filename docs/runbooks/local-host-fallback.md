# Host Node.js fallback and MCP authoring

Optional host processes, the MCP authoring adapter and host-process smokes.

## Optional host Node.js fallback

Use Node.js from `.node-version` and pnpm from `packageManager` only when a faster host loop is
useful:

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm infra:up
pnpm --filter @inside/backend db:migrate
pnpm --filter @inside/backend db:seed
pnpm dev
```

Individual adapters are `pnpm dev:web`, `pnpm dev:api` and `pnpm dev:mcp`. On macOS a low
open-file limit (`launchctl limit maxfiles` of 256) makes `next dev` fail with
`Watchpack Error ... EMFILE`; raise the limit and poll in the same command, for example
`ulimit -n 65536; WATCHPACK_POLLING=true pnpm dev:web`. `pnpm editor:local` forwards
`WATCHPACK_POLLING` to the processes it starts. `pnpm local:setup` is a
host-pnpm convenience wrapper that starts the disposable smoke project with the published demo and
runs the smoke; it refuses to start while any Platform stack owns the ports.

### MCP authoring

The MCP adapter uses stateless Streamable HTTP at `MCP_SERVER_URL` (local default
`http://127.0.0.1:3002/mcp`). It verifies a short-lived Logto-compatible bearer token, resolves its
issuer/subject to an existing Account and checks the Account's current `materials:manage`
permission inside each Materials authoring operation. Communications tools independently check
`communications:manage` and a confirmed Telegram link. Provider roles and scopes do not grant
access, and the adapter has no service identity or provider secret.

Owner billing tools `billing_<operation>` are described in
[owner billing operations](local-acceptance-sale.md#owner-billing-operations); they check `billing:manage`, not
`materials:manage`.

The complete exposed tool set is the generated snapshot `apps/backend/mcp/tool-surface.json`;
`pnpm mcp:check` fails when the registered tools and that snapshot disagree, and `pnpm mcp:generate`
rewrites it. Materials authoring exposes the `material_*`, `content_collection_*`, `product_*` and
`playlist_*` tools; the Video tools use the same Videos facet as the editor and its current
`materials:manage` check.
`material_save` requires an explicit `primaryVideoId`: preserve the value from `material_load`,
or pass `null` to detach without requesting provider deletion. Older clients omitting the field
receive a validation error instead of silently detaching the Video.
See [the video authoring procedure](video-authoring.md) for exact steps and limits.
Material Save replaces content, metadata, current relations, access
and publication state atomically using `expectedContentVersion`; Series composition Save replaces
the full ordered composition using its optimistic version. Both can affect live content and have no
server-side Undo/history. Preview uses canonical ContentAccess. MCP clients can discover the protected resource
metadata at `/.well-known/oauth-protected-resource/mcp` and send the delegated token in the
`Authorization: Bearer` header. Production provider setup and public routing remain outside this
repository task.

The `playlist_*` identifiers are stable protocol names for Series operations. For `stepGroups`,
composition versions and the Git `step_groups` handoff, follow the
[Series composition contract](../specifications/platform-v1.md#series-step-sequences).
For editorial originals and publication ownership, follow the
[content boundary](../product/platform-mvp-brief.md#контент).

NestJS loads the optional repository `.env` through `@nestjs/config` outside test mode, validates
it with Zod, and injects one immutable `PlatformConfig`. Checks therefore see the declared
environment and not your local ports; see the
[runtime configuration contract](runtime-configuration.md#sources-and-precedence). Next.js validates one server-only `WebRuntimeConfig` during
Node.js server startup. `NODE_ENV=development` enables checked-in local defaults; absent
`NODE_ENV` is production, where all runtime values are required.

Inspect the running host fallback or Compose stack:

- health: <http://127.0.0.1:3001/health>
- OpenAPI UI: <http://127.0.0.1:3001/openapi>
- local S3-compatible endpoint: <http://127.0.0.1:9000>
- local Object Storage console: <http://127.0.0.1:9001>
- MCP Streamable HTTP endpoint: <http://127.0.0.1:3002/mcp>
- MCP protected-resource metadata: <http://127.0.0.1:3002/.well-known/oauth-protected-resource/mcp>
- published Material API (smoke project only): <http://127.0.0.1:3001/materials/kak-ustroen-inside-platform>
- published catalog API: <http://127.0.0.1:3001/library/materials>
- Material authoring OpenAPI group: <http://127.0.0.1:3001/openapi#/Material%20authoring>
- production Reader (smoke project only): <http://127.0.0.1:3000/materials/kak-ustroen-inside-platform>

The API health response is:

```text
{"process":"api","status":"ready","database":"reachable","release":{"release":"development","sourceSha":"0000000000000000000000000000000000000000"},"schema":{"identity":"sha256:<migration-registry-sha256>","migrationCount":<migration-count>}}
```

`pnpm smoke:health` verifies Nest composition and the documented `tsx watch` API entrypoint.
Host diagnostic launchers and the production-web browser-test launcher require Python 3 for
`scripts/owned-process.py`. The supervisor keeps a private pipe to the Node owner and tracks the
command's process groups. Owner exit, SIGINT, SIGTERM or SIGKILL closes that pipe. Shutdown sends
SIGTERM, then SIGKILL after a five-second grace period; command completion also clears remaining
descendants before the supervisor reports its status. `scripts/contracts/owned-process.test.mjs` verifies
these paths with real signal-resistant child processes.
The supervisor also observes launching ancestors: a killed test CLI must stop load created by a
surviving worker. `pnpm test:practice-review` runs the native test CLI through
`scripts/owned-node.mjs`, which owns the runner and its workers outside their test hooks. For a
standalone native run, use `node scripts/owned-node.mjs` before the Node arguments too.

The external CLI also accepts `--command <executable> <args...>` for synchronous shell contracts.
Their deadline sends TERM to this owner. The owner waits for the separate supervisor to clear the
command tree with bounded TERM/KILL cleanup before it exits.

On macOS, a unique inherited `INSIDE_OWNED_PROCESS_*` environment entry also identifies detached
descendants after an intermediate launcher has been reaped. `spawnOwned` preserves outer entries
when a nested owner supplies a replacement environment. Commands that construct their own child
environment must preserve these entries too. A detached descendant that loses both its ancestry
and its marker cannot be recovered from a later process-table snapshot. Discovery binds the marker
to the process birth identity before adding its group to cleanup.
macOS can hide environment entries for restricted processes; discovery then relies on retained
ancestry and known groups. On Linux, the supervisor becomes a subreaper before launching the
command, so orphaned detached descendants are adopted and cleaned up even after intermediary exit.

`pnpm smoke:fullstack` remains the host-process fallback smoke against Compose PostgreSQL (start it
with `pnpm infra:up`); it gives its processes the stand's local sale contour, because the seed puts a
Product on sale and the API refuses to start a sale without a bank and a receipt mailbox. It
starts the API and a production-built web process whose CSP admits exactly the loopback storage
origin the API signs image links for (ADR 0028), verifies the published Reader on desktop and
mobile through Playwright, exercises the server-only adapter against the live API, and uses a
signed delegated owner token to create/reload, publish, Preview and unpublish one stable Material
through the live MCP process. The refusal of a communications tool is proved with a second
delegated Account that the launcher grants exactly `materials:manage`: the owner Account of a
working machine may already carry `communications:manage`, and that step must read authority
rather than the history of the local database.

The smoke writes the Git-ignored `apps/web/release-identity.json` at start and removes it when it
ends. A killed run leaves the file behind, and the next run stops with `Refusing to replace`: make
sure no other smoke is running in this worktree, delete the file, and start again.

`pnpm smoke:enrollments` separately owns the course-recipient, catalog and provider fixtures for
`playwright.enrollment.config.ts`; the general full-stack configuration does not run that fixture-dependent suite.
`pnpm smoke:buyer-journey` owns the buyer path of a product (Platform #775): its fixture
`apps/backend/scripts/buyer-journey-fixture.ts` starts disposable PostgreSQL, the real API with the
seeded demo product, the stand bank double, a mail capture for the receipt email code and a
synthetic OIDC provider whose only sign-in is Telegram, confirmed by a synthetic Inside bot. The
browser suite `playwright.buyer-journey.config.ts` opens the product page, signs in with Telegram,
checks the free and the closed chapter, buys on the bank double and checks the opened chapter and
the community right, on desktop and mobile. It needs Docker and the Chromium of Playwright only.
`pnpm check:full` runs all three smokes, and CI Integration runs the enrollment and buyer journey smokes
after PostgreSQL integration tests.

`pnpm smoke:enrollments` and `pnpm smoke:buyer-journey` start the web with `next dev` and open every address of their scenario before the
browser suite runs. The Turbopack dev server of Next.js 16 sometimes reports `Ready` without a part
of its routes, and a missing route answers 404 until the process ends
([vercel/next.js#98985](https://github.com/vercel/next.js/issues/98985)); the smoke then restarts
the server, at most three times, and prints `Dev server start … answers 404 for …`. In CI the line
is a warning annotation on the run. A 404 that survives three starts fails the smoke: the address
or its seed data is gone, or the route list in the smoke script is stale. When a scenario starts to
reach a new page or route handler, add its address to the list in the smoke script. The smokes take
their ports from 20000–29999, below the range the operating system and Docker hand out, so a
reserved port stays free until its server binds it (`scripts/smoke-stand.mjs`, #863).
The legacy full-stack fixture freezes the seeded material corpus. Materials created afterward do not become
accessible to that cohort without an explicit scoped basis; video checks distinguish this denial from owner access.

The identity fixture of that launcher serves a JWKS, a discovery document and a refresh-token grant
on loopback, so a signed-in session can outlive the five minutes of one access token and last the
whole run. The five-minute lifetime itself is unchanged and the API still verifies it; the web BFF
renews the token through its ordinary path, the same one it uses in production. The fixture is a
stand-in, not Logto: it authenticates no client on the token endpoint, never rotates a refresh
token, and serves only the three endpoints it implements. What it does reproduce exactly is the
renewal the application performs and the refusal body of the Logto fork (`error: "invalid_grant"`,
`code: "oidc.invalid_grant"`, `message`), so a refusal is seen as a signed-out session rather than
an unavailable service (#1005). A grant whose `resource` is the learner MCP
endpoint (`<MCP_SERVER_URL>/learning`) answers a token for that audience with the `learning:read`
scope (#948): `task-submissions.spec.ts` plays the learner's agent with a refresh token the launcher
issues for the non-member Account, and any other resource is still refused.

`signInFullStack` in `apps/web/test/support/full-stack-session.ts` checks `/auth/status` right
after setting the cookie, so a session that cannot be renewed fails as an expired session instead
of a missing element, and an unavailable application is named as such instead of being blamed on
the session. `session-lifetime.spec.ts` covers renewal, refusal and that message on a session whose
token has already run out; `scripts/full-stack-identity.test.mjs` covers the grant itself without
starting the stack. Whether the whole suite is free of expiry-driven failures is a property of a
full `pnpm smoke:fullstack` run, not of these checks.

The full-stack launcher also establishes separate active-member, non-member, expired-member and stale-member
Accounts. Confirmed loss of Membership resolves as `expired`; a formerly valid observation accepted
through the normal facet with a historical fixture clock resolves as `stale` at the real clock. The media convergence scenarios exercise one
Material with image, file and primary Video, direct resource denials and an unrouted browser image
cache after sign-out. Kinescope remains the deterministic test adapter; real-provider release
acceptance belongs to #184.
