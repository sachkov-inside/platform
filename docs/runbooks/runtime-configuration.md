# Runtime configuration contract

Platform has two deployed environments: local development and production. `NODE_ENV=test` is a
process mode used by automated tests, not a deployed environment. CI will validate and build the
same application; it does not become another application environment.

Both applications expose one typed, immutable configuration object to application code:

- NestJS loads the optional repository `.env` through `@nestjs/config`, validates the complete
  process environment with Zod, and provides one `PlatformConfig` through dependency injection.
- Next.js reads server-side runtime variables, validates one `WebRuntimeConfig` during Node.js
  server startup, and derives backend transport and Logto BFF configuration from it.

Application modules do not read variable names through `ConfigService` or `process.env`. Pure
parsers remain available for tests, migrations, seeds and command-line entrypoints. Invalid
production configuration stops a process before it can report ready.

## Sources and precedence

An already exported process or container variable wins over a value from an env file. Local
defaults apply only when `NODE_ENV` is `development` or `test`. Missing `NODE_ENV` is treated as
`production`, so a production process cannot silently start with local credentials or endpoints.

| Source | Tracked | Contains | Consumer |
| --- | --- | --- | --- |
| `.env.example` | yes | safe local values and override names | local development reference |
| `.env` | no | developer-specific local overrides | local Compose and host processes |
| `.env.production.example` | yes | production variable names and placeholders | server setup reference |
| `.env.production` | no, server only | production values and secrets | production Compose interpolation |

The baseline intentionally uses one server-owned production env file. It is copied manually before
the first start, kept outside Git and restricted to its owner. CI/CD lessons will later separate
stable runtime secrets from public per-release image metadata and automate only the safe part.

Do not add `.env.development` or `.env.test`. Local defaults and explicit test fixtures keep those
modes deterministic. Do not bake application runtime secrets into a Docker image or pass them as
Docker build arguments.

## Docker Compose flow

Development uses `compose.yaml`. Docker Compose loads the root `.env` for `${VARIABLE}`
interpolation, applies checked-in local fallback values and passes an explicit `environment` map to
each service. Values that are not listed for a service are not copied into its container.

Production uses the server-owned file explicitly:

```bash
docker compose \
  --env-file .env.production \
  --file compose.production.yaml \
  config --quiet
```

Compose resolves required `${VARIABLE:?message}` expressions before containers start. NestJS and
Next.js then validate the values they own, including URL protocols, secret lengths, port ranges and
production-only HTTPS requirements.

The Dockerfile accepts no application runtime values as build arguments. Next.js has no
`NEXT_PUBLIC_*` runtime configuration because those values would be frozen into browser assets
during the image build. The web process reads server-only values when its container starts.

## Configuration ownership

| Group | Examples | Owner |
| --- | --- | --- |
| Backend application | `DATABASE_URL`, Logto verifier, Telegram and Object Storage values | `PlatformConfig` |
| Web server/BFF | `BACKEND_BASE_URL`, Logto app and cookie values, `WEB_BASE_URL` | `WebRuntimeConfig` |
| Database bootstrap | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | production Compose |
| Deployment transport | future SSH host, user, key and known hosts | future protected CI/CD environment |

When introducing a variable, add it to the owning Zod schema, typed config object, focused parser
tests, relevant Compose service and tracked example. Put its real production value only in the
server-owned environment file until a later lesson introduces a secret manager or encrypted
configuration flow.
