# Local PostgreSQL and migrations

Inspect the stand database and check migrations and the Prisma schema.

## Inspect PostgreSQL

```bash
docker compose exec postgres psql -U inside -d inside
```

Useful read-only commands:

```sql
\dt materials.*
select position, name, checksum, applied_at
from public.platform_migrations
order by position;
select id, slug, publication_state, content_version, updated_at
from materials.materials
order by created_at;
```

The migration and seed jobs are safe to repeat manually:

```bash
docker compose run --rm migrations
docker compose run --rm seed
```

The seed refuses non-development mode, uses stable idempotency keys, and creates 22 free published
Materials plus one Membership Material whose body remains absent from the public catalog. The free
fixtures cover catalog pagination, Home formats and one explicit Series-reading scenario:
`demo-series-harness` orders a shared product before a final product,
`demo-series-review` orders the same shared product before a video and note, and
`demo-295-samostoyatelnaya-zametka` belongs to no Series. Their titles and summaries identify them
as development examples rather than editorial content. Repeating the seed keeps the same Materials
and brings each one back to its definition in `seed-local-development.ts` without resetting the
named volume: a body, `difficulty` or `outcomes` edited in that file after the volume was seeded
still reaches the existing Material, and a Material that already matches its definition receives no
change command at all. Editing a *title* is the exception, and it splits by how the Material is
recognised: most definitions name the slug they own and are renamed in place, but the eleven
demo-Series lessons are recognised by title alone, and renaming one of those on an already seeded
volume fails the seed with `idempotency_key_reused`: the old Material is no longer found and
creation meets its own stable key. Rename such a lesson on a fresh volume, or remove the old
Material by hand first. Materials are created and published through the Materials application
interface; the seed uses Prisma model operations to find what an earlier run created, to pin the
related Material, and to write the fixed local Topic/Format/Tag/Series prerequisites, because
Platform has no product taxonomy-authoring capability yet.

## Migration and Prisma schema checks

With the host fallback database running:

```bash
pnpm --filter @inside/backend db:migrate
pnpm --filter @inside/backend db:schema:check
```

`db:schema:check` validates `prisma/schema.prisma` and regenerates the ignored TypeScript client.
The same generation runs during install, build, and typecheck:

```bash
pnpm --filter @inside/backend prisma:generate
```

After pulling or merging `main`, run `pnpm build:generated` before a standalone `pnpm lint`: it
rebuilds the workspace packages and the Prisma client. Type-aware lint reads both, so a stale `dist`
or client reports unsafe `any` errors in files the change never touched. `pnpm check:static` runs it
before lint.

The Prisma schema maps the product-owned `billing`, `materials`, `assets`, `accounts`, `member_profiles`,
`account_rights`, `reading_activity`, `notifications` and `telegram_membership` schemas. Checked-in,
append-only SQL migrations remain the database authority. Their explicit positions and checksums
must form an exact registry prefix, rejecting drift, gaps, reordering, and newer unknown migrations;
generated client files are not committed or edited. A pre-Prisma local volume must be recreated
with the [destructive reset](local-stand.md#destructive-reset) rather than supported by application compatibility code.

An integration test that upgrades from a historical point uses
`apps/backend/test/integration/setup/historical-upgrade.ts`: `migrateBefore` stops the ledger before
a named migration, the test seeds its rows, and `upgradeToLatest` derives the applied tail from the
registry, checks that the ledger then equals the registry by name and position, and that a replay
applies nothing. `historical-upgrade.test.ts` pins the identity of the registry as it stood on
22.10.2026, so removing, renaming, reordering or editing a historical migration still fails a test.
A new migration at the end of the registry therefore needs no edits in existing upgrade tests.
