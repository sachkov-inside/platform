import { createHash } from "node:crypto";

import { Pool, type PoolClient } from "pg";
import { z } from "zod";

export interface Migration {
  readonly name: string;
  readonly statement: string;
}

export interface MigrationOutcome {
  readonly appliedMigrations: readonly string[];
}

export interface MigrationVerification {
  readonly appliedMigrations: readonly string[];
  readonly jobSchemaVersion: number | null;
}

const appliedMigrationSchema = z.strictObject({
  checksum: z.string().length(64),
  name: z.string().min(1),
  position: z.number().int().positive(),
});
const relationRowSchema = z.strictObject({ relation: z.string().nullable() });
const relationPresenceRowSchema = z.strictObject({ has_relations: z.boolean() });
const ledgerColumnRowsSchema = z.array(
  z.strictObject({ name: z.string().min(1) }),
);
const pgBossVersionRowsSchema = z
  .array(z.strictObject({ version: z.number().int().positive() }))
  .max(1);

export type AppliedMigration = z.infer<typeof appliedMigrationSchema>;

export function parseAppliedMigrations(value: unknown): AppliedMigration[] {
  return z.array(appliedMigrationSchema).parse(value);
}

export function parsePgBossSchemaVersionRows(value: unknown): number | null {
  return pgBossVersionRowsSchema.parse(value)[0]?.version ?? null;
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
      const ledgerColumns = ledgerColumnRowsSchema.parse(
        (
          await connection.query(`
            select column_name as name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'platform_migrations'
          `)
        ).rows,
      );
      const ledgerColumnNames = new Set(ledgerColumns.map(({ name }) => name));
      if (
        !["name", "position", "checksum", "applied_at"].every((column) =>
          ledgerColumnNames.has(column),
        )
      ) {
        throw new Error(
          "Migration ledger format mismatch; recreate the pre-Prisma database",
        );
      }
      const applied = parseAppliedMigrations(
        (
          await connection.query(
            "select name, position, checksum from public.platform_migrations order by position",
          )
        ).rows,
      );
      assertAppliedMigrations(applied, migrations);
      const appliedMigrations: string[] = [];
      for (
        let index = applied.length;
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

export async function verifyMigrationState(
  connectionString: string,
  migrations: readonly Migration[],
): Promise<MigrationVerification> {
  assertUniqueMigrationNames(migrations);
  return withMigrationConnection(connectionString, async (connection) => {
    const relation = relationRowSchema.parse(
      (
        await connection.query(
          "select to_regclass('public.platform_migrations') as relation",
        )
      ).rows[0],
    ).relation;
    if (relation === null) {
      const tablesResult = await connection.query(`
        select exists (
          select 1
          from information_schema.tables
          where table_schema <> 'information_schema'
            and table_schema not like 'pg_%'
            and table_type = 'BASE TABLE'
        ) as has_relations
      `);
      const tablesRow = relationPresenceRowSchema.parse(tablesResult.rows[0]);
      if (tablesRow.has_relations) {
        throw new Error("Migration ledger is missing from a non-empty database");
      }
      return { appliedMigrations: [], jobSchemaVersion: null };
    }
    const applied = parseAppliedMigrations(
      (
        await connection.query(
          "select name, position, checksum from public.platform_migrations order by position",
        )
      ).rows,
    );
    assertAppliedMigrations(applied, migrations);
    return {
      appliedMigrations: applied.map(({ name }) => name),
      jobSchemaVersion: await readPgBossSchemaVersion(connection),
    };
  });
}

async function readPgBossSchemaVersion(
  connection: PoolClient,
): Promise<number | null> {
  const relation = relationRowSchema.parse(
    (await connection.query("select to_regclass('pgboss.version') as relation"))
      .rows[0],
  ).relation;
  if (relation === null) {
    return null;
  }
  return parsePgBossSchemaVersionRows(
    (await connection.query("select version from pgboss.version")).rows,
  );
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
