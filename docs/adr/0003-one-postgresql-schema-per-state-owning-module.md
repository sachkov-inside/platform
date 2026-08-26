---
status: accepted
---

# One PostgreSQL schema per state-owning module

Platform remains one modular monolith with one PostgreSQL database, pool, runtime role and migration
authority. Each capability Module that owns persistent application state owns one PostgreSQL schema
named after that Module; a Module without persistent state does not receive an empty schema. The
current names are `Materials` → `materials` and `Accounts` → `accounts`.

The schema is an ownership and architecture seam, not a security or failure-isolation boundary.
Only the owning Module's implementation and migrations may reference its tables. Other Modules use
its public interface rather than cross-schema queries, views, foreign keys or writes, and store
foreign references as opaque identifiers when needed. Schema-qualified generated types,
architecture guardrails and real-PostgreSQL integration tests enforce this rule while the shared
runtime role deliberately preserves one pool and simple application transactions.

The local-development seed is the sole explicit bootstrap exception: it may write fixed reference
data to `materials` through schema-qualified typed queries. It is not production Module
coordination, and the guardrail rejects application-schema references from every other non-owning
source path.

Platform infrastructure and library-owned schemas, including migration metadata and the future
`pg-boss` schema, keep their own lifecycle and do not become shared business schemas. Migration
`0003_materials_schema` moves existing Materials objects from `public` to `materials` without
rewriting frozen migrations. New state-owning Modules create their schema in their first real
migration, not during speculative scaffolding.
