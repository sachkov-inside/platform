import { createHash } from "node:crypto";

import { Pool } from "pg";

export interface Migration {
  readonly name: string;
  readonly statement: string;
}

export interface MigrationOutcome {
  readonly appliedMigrations: readonly string[];
}

export async function runMigrationsToLatest(
  connectionString: string,
  migrations: readonly Migration[],
): Promise<MigrationOutcome> {
  assertUniqueMigrationNames(migrations);
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  const connection = await pool.connect();
  try {
    await connection.query("begin");
    await connection.query(
      "select pg_advisory_xact_lock(hashtext('inside-platform-migrations'))",
    );
    await connection.query(`
      create table if not exists public.platform_migrations (
        name text primary key,
        position integer not null unique check (position > 0),
        checksum char(64) not null,
        applied_at timestamptz not null default now()
      )
    `);
    const ledgerColumns = await connection.query<{ readonly name: string }>(`
      select column_name as name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'platform_migrations'
    `);
    const ledgerColumnNames = new Set(ledgerColumns.rows.map(({ name }) => name));
    if (
      !["name", "position", "checksum", "applied_at"].every((column) =>
        ledgerColumnNames.has(column),
      )
    ) {
      throw new Error(
        "Migration ledger format mismatch; recreate the pre-Prisma database",
      );
    }
    const applied = await connection.query<{
      readonly checksum: string;
      readonly name: string;
      readonly position: number;
    }>(
      "select name, position, checksum from public.platform_migrations order by position",
    );
    assertAppliedPrefix(applied.rows, migrations);
    const appliedMigrations: string[] = [];
    for (
      let index = applied.rows.length;
      index < migrations.length;
      index += 1
    ) {
      const migration = migrations[index];
      if (migration === undefined) {
        throw new TypeError("Migration registry changed during execution");
      }
      const checksum = migrationChecksum(migration.statement);
      await connection.query(migration.statement);
      await connection.query(
        `insert into public.platform_migrations (name, position, checksum)
         values ($1, $2, $3)`,
        [migration.name, index + 1, checksum],
      );
      appliedMigrations.push(migration.name);
    }
    await connection.query("commit");
    return { appliedMigrations };
  } catch (error) {
    await connection.query("rollback");
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

function assertUniqueMigrationNames(migrations: readonly Migration[]): void {
  const names = new Set<string>();
  for (const { name } of migrations) {
    if (names.has(name)) {
      throw new Error(`Duplicate migration name: ${name}`);
    }
    names.add(name);
  }
}

function assertAppliedPrefix(
  applied: readonly {
    readonly checksum: string;
    readonly name: string;
    readonly position: number;
  }[],
  migrations: readonly Migration[],
): void {
  for (const [index, row] of applied.entries()) {
    const migration = migrations[index];
    if (migration === undefined || row.position !== index + 1 || row.name !== migration.name) {
      throw new Error(
        `Migration ledger is not an exact registry prefix at position ${String(index + 1)}`,
      );
    }
    if (row.checksum !== migrationChecksum(migration.statement)) {
      throw new Error(`Migration checksum mismatch: ${migration.name}`);
    }
  }
}

function migrationChecksum(statement: string): string {
  return createHash("sha256").update(statement).digest("hex");
}
