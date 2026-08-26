---
status: accepted
---

# Use Prisma directly in backend use cases

Platform uses Prisma 7 as the only application ORM. A vertical slice may call an injected,
capability-scoped Prisma client directly; Prisma is already the persistence abstraction, so
Platform does not add generic repositories, Unit of Work wrappers, pass-through persistence
services, or one DI token per query. Domain objects and public module contracts remain independent
from Prisma.

Ordinary reads and writes use Prisma model operations. PostgreSQL features that Prisma does not
express clearly—row locks, advisory locks, tuple cursor pagination, aggregate projections,
triggers, and deferrable constraints—use checked-in, parameterized `Prisma.sql` or module-owned
migration SQL. Raw-query results enter the application as `unknown` and are runtime-validated by
the owning slice. Unsafe raw-query methods, dynamic table identifiers, unqualified table names,
and cross-capability schema access are forbidden.

One application-scoped Prisma lifecycle owns `@prisma/adapter-pg` and its bounded connection pool.
Capability-scoped client types expose only the delegates and transaction surface owned by that
module. Nest DI binds this lifecycle at composition seams; use cases remain plain functions. The
`pg` package is limited to the migration runner and isolated database administration in tests—it
is not a second application data-access path.

Feature-specific persistence stays beside the use case. A persistence function is extracted only
after real reuse or when it hides one cohesive, non-trivial query such as revision hydration. This
keeps vertical slices navigable without duplicating complex consistency logic.

Checked-in, append-only SQL migrations remain the database authority because Platform relies on
PostgreSQL constraints and indexes that are not completely described by the Prisma schema. The
central runner applies them in order under an advisory lock and records an explicit position plus
a SHA-256 checksum. The ledger must be an exact prefix of the running registry; an edited, missing,
reordered, or unknown applied migration fails closed. The Prisma schema maps the resulting `materials` and
`identity_principals` schemas and generates the ignored TypeScript client during install, build,
and typecheck.

The Prisma cutover is a single current path. The former Kysely adapter, generated mappings,
lifecycle, dependency, and migration-history adoption code were deleted. Pre-cutover development
databases and checksum-less migration ledgers are recreated instead of carrying a permanent
compatibility branch in production code.

This trades some use-case coupling to Prisma for substantially lower navigation and assembly cost.
Moving to another database API would touch persistence-aware slices, but it would not change domain
rules, capability interfaces, HTTP adapters, or application result contracts.
