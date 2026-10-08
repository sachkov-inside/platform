# Backend

## Role

`apps/backend` is one NestJS modular monolith with thin demand-driven process entrypoints in
`src/entrypoints/`; add a capability-specific worker only with its first durable job. Put
behaviour behind capability interfaces.

## Required context

Before changing or reviewing backend code, apply [`CODING_STANDARDS.md`](CODING_STANDARDS.md).

Run `pnpm --filter @inside/backend guardrails` after changing imports, public interfaces, result
unions, TypeScript projects, or lint configuration.

## Context pointers

Read the owning document before changing:

- slice layout, module interfaces, dependency wiring, or architecture guardrails:
  [ADR 0004](../../docs/adr/0004-feature-first-backend-modules.md); an import between Modules:
  [ADR 0029](../../docs/adr/0029-acyclic-module-dependencies.md);
- Prisma access, raw SQL, schema mapping, or persistence placement:
  [ADR 0005](../../docs/adr/0005-prisma-in-use-cases.md);
- the Materials interface, model, body codec, composition, or persistence:
  [ADR 0009](../../docs/adr/0009-one-mutable-material.md) and the backend contract in
  [`platform-v1.md`](../../docs/specifications/platform-v1.md);
- an entrypoint or process lifecycle, or a proposed backend package, process, or deployable:
  [ADR 0001](../../docs/adr/0001-one-backend-multiple-entrypoints.md) and the backend contract in
  [`platform-v1.md`](../../docs/specifications/platform-v1.md);
- Account, permission, Logto, or identity persistence behaviour:
  [`identity-principals-session-v1.md`](../../docs/specifications/identity-principals-session-v1.md),
  [`idp-application-flow-v1.md`](../../docs/specifications/idp-application-flow-v1.md) and
  [ADR 0006](../../docs/adr/0006-logto-session-and-local-account.md);
- migrations, the Prisma schema/client, or local PostgreSQL workflows: follow
  [`local-development.md`](../../docs/runbooks/local-development.md).

## Verification

- Pure domain and `MaterialBody` behaviour uses unit tests.
- Application persistence, transactions, constraints, rollback, idempotency, and concurrency use
  capability interfaces against real PostgreSQL; fake only genuinely variable external ports.
- Transport adapters keep focused mapping tests separate from application acceptance.
- Run `pnpm test:integration` when PostgreSQL behaviour, migrations, Prisma mappings, or
  transaction semantics may have changed.
