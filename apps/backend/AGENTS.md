# Backend

## Role

`apps/backend` is one NestJS modular monolith with thin `api`, `worker`, and `mcp` process
entrypoints. Put behaviour behind capability interfaces; add a package, process, or deployable only
when a separate operational seam has real consumers.

## Module seams

- Start from a capability `index.ts`. Production callers import that public interface; capability
  application, domain, and infrastructure files remain implementation details.
- Keep application results transport-neutral and discriminated. Each operation exposes its actual
  error union, and every adapter mapping is exhaustive.
- Treat external input as `unknown` until the owning module validates it. Public DTOs keep
  serializable string identifiers; domain and persistence code use checked branded identifiers.
- Keep application and domain code independent of Nest, Kysely, `pg`, and generated database
  shapes. Raw persistence imports live only in paths approved by the architecture guardrail.
- Keep `MaterialBody` validation, versioning, rendering, and extraction inside Materials until an
  independent caller proves another seam.

Run `pnpm --filter @inside/backend guardrails` after changing imports, public interfaces, result
unions, TypeScript projects, or lint configuration. Completion means both the positive repository
scan and every negative fixture pass.

## Context pointers

- When changing the Materials interface, model, body codec, composition, or persistence, read
  [`docs/adr/0002-deep-materials-module.md`](../../docs/adr/0002-deep-materials-module.md) and the
  backend contract in [`docs/specifications/platform-v1.md`](../../docs/specifications/platform-v1.md).
- When changing an entrypoint or process lifecycle, read
  [`docs/adr/0001-one-backend-multiple-entrypoints.md`](../../docs/adr/0001-one-backend-multiple-entrypoints.md).
- When changing migrations, generated database types, or local PostgreSQL workflows, follow
  [`docs/runbooks/local-development.md`](../../docs/runbooks/local-development.md). Frozen
  migrations stay self-contained; migration authors regenerate and commit database types.

## Verification

- Pure domain and `MaterialBody` behaviour uses unit tests.
- Application persistence, transactions, constraints, rollback, idempotency, and concurrency use
  capability interfaces against real PostgreSQL; fake only genuinely variable external ports.
- Transport adapters keep focused mapping tests separate from application acceptance.
- Run focused backend checks while iterating, then run root `pnpm check` before handoff. Run
  `pnpm test:integration` when PostgreSQL behaviour, migrations, generated types, or transaction
  semantics may have changed.
