# Backend

## Role

`apps/backend` is one NestJS modular monolith with thin demand-driven process entrypoints. The
current entrypoints are `api` and `mcp`; add a capability-specific worker only with its first
durable job. Put behaviour behind capability interfaces.

## Required context

Before changing or reviewing backend code, apply
[`CODING_STANDARDS.md`](../../CODING_STANDARDS.md). It is the single source of truth for vertical
slices under `features/`, naming, module interfaces, Nest DI, and allowed imports.

## Backend contracts

- Keep application results transport-neutral and discriminated. Each operation exposes its actual
  error union, and every adapter mapping is exhaustive.
- Treat external input as `unknown` until the owning module validates it. Public DTOs keep
  serializable string identifiers; domain and persistence code use checked branded identifiers.
- Keep `MaterialBody` validation, versioning, rendering, and extraction inside Materials until an
  independent caller proves another seam.

Run `pnpm --filter @inside/backend guardrails` after changing imports, public interfaces, result
unions, TypeScript projects, or lint configuration. Completion means both the positive repository
scan and every negative fixture pass.

## Context pointers

- When changing slice layout, module interfaces, dependency wiring, or architecture guardrails,
  read
  [`ADR 0004`](../../docs/adr/0004-feature-first-backend-modules.md).
- When changing Prisma access, raw SQL, schema mapping, or persistence placement, read
  [`ADR 0005`](../../docs/adr/0005-prisma-in-use-cases.md).
- When changing the Materials interface, model, body codec, composition, or persistence, read
  [`ADR 0002`](../../docs/adr/0002-deep-materials-module.md), its mutable-model replacement
  [`ADR 0009`](../../docs/adr/0009-one-mutable-material.md), and the backend contract in
  [`docs/specifications/platform-v1.md`](../../docs/specifications/platform-v1.md).
- When changing an entrypoint or process lifecycle, or proposing another backend package, process,
  or deployable, read
  [`docs/adr/0001-one-backend-multiple-entrypoints.md`](../../docs/adr/0001-one-backend-multiple-entrypoints.md)
  and the backend contract in
  [`docs/specifications/platform-v1.md`](../../docs/specifications/platform-v1.md).
- When changing Account, permission, Logto, or identity persistence behaviour, read
  [`docs/specifications/identity-principals-session-v1.md`](../../docs/specifications/identity-principals-session-v1.md)
  and
  [`docs/specifications/idp-application-flow-v1.md`](../../docs/specifications/idp-application-flow-v1.md),
  plus [`ADR 0006`](../../docs/adr/0006-logto-session-and-local-account.md).
- When changing migrations, the Prisma schema/client, or local PostgreSQL workflows, follow
  [`docs/runbooks/local-development.md`](../../docs/runbooks/local-development.md). Frozen
  migrations stay self-contained; generated Prisma client files are never edited or committed.

## Verification

- Pure domain and `MaterialBody` behaviour uses unit tests.
- Application persistence, transactions, constraints, rollback, idempotency, and concurrency use
  capability interfaces against real PostgreSQL; fake only genuinely variable external ports.
- Transport adapters keep focused mapping tests separate from application acceptance.
- Run focused backend checks while iterating, then run root `pnpm check` before handoff. Run
  `pnpm test:integration` when PostgreSQL behaviour, migrations, Prisma mappings, or transaction
  semantics may have changed.
