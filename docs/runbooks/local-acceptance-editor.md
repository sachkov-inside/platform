# Local editor acceptance stand

An isolated editor runtime, separate from the shared stand.

## Local editor acceptance

`pnpm editor:local` runs the real editor and API against isolated PostgreSQL at port 54396 and
RustFS at 9036. It refuses production configuration by constructing its own local environment.
Before starting identity, migrations or child processes, the launcher checks that its three
loopback ports are free. A busy port causes an error naming its environment variable; the launcher
does not stop the process that owns it. Configure distinct ports when another local runtime uses
the defaults:

| Environment variable | Default | Listener |
|---|---|---|
| `EDITOR_LOCAL_GATEWAY_PORT` | `4396` | Browser gateway |
| `EDITOR_LOCAL_API_PORT` | `4397` | API |
| `EDITOR_LOCAL_WEB_PORT` | `4398` | Internal Next.js |

```bash
EDITOR_LOCAL_GATEWAY_PORT=4496 EDITOR_LOCAL_API_PORT=4497 EDITOR_LOCAL_WEB_PORT=4498 pnpm editor:local
```

For that example, open `http://127.0.0.1:4496/authoring/materials`. The gateway validates `Host`
and sets `x-forwarded-host` to the selected gateway host and port. API requests use the selected
API port. Authoring tools can address a custom gateway by its explicit loopback origin;
the named `editor` target retains its default port 4396.

Start dedicated containers, separate from the singleton Compose stack:

```bash
docker run -d --name platform-396-postgres -e POSTGRES_USER=inside -e POSTGRES_PASSWORD=inside -e POSTGRES_DB=inside -p 127.0.0.1:54396:5432 ghcr.io/sachkov-inside/postgres:18.4-alpine3.23@sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e
docker run -d --name platform-396-storage -e RUSTFS_ACCESS_KEY=inside-local-access-key -e RUSTFS_SECRET_KEY=inside-local-secret-key -p 127.0.0.1:9036:9000 "$(docker compose config --images object-storage)"
pnpm editor:local
```

Open `http://127.0.0.1:4396/authoring/materials`. The loopback gateway supplies a synthetic local
owner session using the same identity fixture as the full-stack tests; it refreshes short-lived
credentials server-side. The local Account receives explicit `platform:admin`. No production
identity, permission, credential or provider configuration is read or changed. This proves editor,
BFF, API, persistence and storage behaviour, not real Logto sign-in or Kinescope upload/playback.
The Kinescope test adapter completes uploads without sending the selected video to Kinescope.

Run `pnpm --filter @inside/web exec playwright test --config playwright.editor.config.ts` while
this runtime is running. Stop its launcher before root `pnpm check` because the Next development
server uses one build directory per worktree. Ctrl+C stops the launcher processes; the two dedicated
containers retain local data. Stop only those containers when the review is finished:

```bash
docker stop platform-396-postgres platform-396-storage
```

Do not remove their data or use the shared Compose shutdown command for this isolated runtime.
