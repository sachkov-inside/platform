import { createHash } from "node:crypto";

import { Pool, type PoolClient } from "pg";

export interface Migration {
  readonly name: string;
  readonly statement: string;
}

export interface MigrationOutcome {
  readonly appliedMigrations: readonly string[];
}

export interface MigrationVerification {
  readonly appliedMigrations: readonly string[];
}

export interface AppliedMigration {
  readonly checksum: string;
  readonly name: string;
  readonly position: number;
}

export async function runMigrationsToLatest(
  connectionString: string,
  migrations: readonly Migration[],
): Promise<MigrationOutcome> {
  assertUniqueMigrationNames(migrations);
  return withMigrationConnection(connectionString, async (connection) => {
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
      const applied = await connection.query<AppliedMigration>(
        "select name, position, checksum from public.platform_migrations order by position",
      );
      assertAppliedMigrations(applied.rows, migrations);
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
    }
  });
}

export async function verifyMigrationLedger(
  connectionString: string,
  migrations: readonly Migration[],
): Promise<MigrationVerification> {
  assertUniqueMigrationNames(migrations);
  return withMigrationConnection(connectionString, async (connection) => {
    const relationResult = await connection.query(
      "select to_regclass('public.platform_migrations') as relation",
    );
    const relationRow: unknown = relationResult.rows[0];
    if (
      typeof relationRow !== "object" ||
      relationRow === null ||
      !("relation" in relationRow) ||
      (relationRow.relation !== null && typeof relationRow.relation !== "string")
    ) {
      throw new Error("Migration ledger lookup returned an invalid row");
    }
    if (relationRow.relation === null) {
      const tablesResult = await connection.query(`
        select exists (
          select 1
          from information_schema.tables
          where table_schema <> 'information_schema'
            and table_schema not like 'pg_%'
            and table_type = 'BASE TABLE'
        ) as has_relations
      `);
      const tablesRow: unknown = tablesResult.rows[0];
      if (
        typeof tablesRow !== "object" ||
        tablesRow === null ||
        !("has_relations" in tablesRow) ||
        typeof tablesRow.has_relations !== "boolean"
      ) {
        throw new Error("Database relation lookup returned an invalid row");
      }
      if (tablesRow.has_relations) {
        throw new Error("Migration ledger is missing from a non-empty database");
      }
      return { appliedMigrations: [] };
    }
    const applied = await connection.query<AppliedMigration>(
      "select name, position, checksum from public.platform_migrations order by position",
    );
    assertAppliedMigrations(applied.rows, migrations);
    return { appliedMigrations: applied.rows.map(({ name }) => name) };
  });
}

async function withMigrationConnection<T>(
  connectionString: string,
  operation: (connection: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const connection = await pool.connect();
    try {
      return await operation(connection);
    } finally {
      connection.release();
    }
  } finally {
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

export function assertAppliedMigrations(
  applied: readonly AppliedMigration[],
  migrations: readonly Migration[],
): void {
  for (const [index, row] of applied.entries()) {
    const migration = migrations[index];
    if (migration === undefined) {
      throw new Error(
        `Migration ledger is not an exact registry prefix at position ${String(index + 1)}`,
      );
    }
    if (row.position !== index + 1 || row.name !== migration.name) {
      throw new Error(
        `Migration ledger is not an exact registry prefix at position ${String(index + 1)}`,
      );
    }
    if (row.checksum !== migrationChecksum(migration.statement)) {
      throw new Error(`Migration checksum mismatch: ${migration.name}`);
    }
  }
}

export function migrationChecksum(statement: string): string {
  return createHash("sha256").update(statement).digest("hex");
}

export function migrationRegistryIdentity(
  migrations: readonly Migration[],
): string {
  const registry = migrations.map(({ name, statement }, index) => ({
    checksum: migrationChecksum(statement),
    name,
    position: index + 1,
  }));
  return `sha256:${createHash("sha256").update(JSON.stringify(registry)).digest("hex")}`;
}
