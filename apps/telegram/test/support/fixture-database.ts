import { Kysely, PostgresDialect } from "kysely";
import { Pool, type PoolClient } from "pg";

import type { Database, DatabaseSchema } from "../../src/database/database.js";

// Bound a stuck fixture connection/query within the existing case and cleanup budgets.
const fixtureIoFailureMilliseconds = 5_000;
// CREATE/DROP can wait for a durable checkpoint after all target clients are gone.
const migrationAdministrationStatementMilliseconds = 15_000;
const migrationAdministrationResponseMilliseconds = 20_000;
export const migrationAdministrationOperationBudgetMilliseconds =
  fixtureIoFailureMilliseconds + migrationAdministrationResponseMilliseconds;

export function createFixtureDatabase(
  databaseUrl: string,
  applicationName: string,
  isCancelling: () => boolean = () => false,
): Database {
  return createBoundedFixtureDatabase(
    databaseUrl,
    applicationName,
    isCancelling,
    "fixture",
  );
}

/** Only the private migration fixture owner uses this connection for CREATE/DROP DATABASE. */
export function createMigrationOwnerDatabase(
  databaseUrl: string,
  applicationName: string,
): Database {
  return createBoundedFixtureDatabase(
    databaseUrl,
    applicationName,
    () => false,
    "migration-administration",
  );
}

function createBoundedFixtureDatabase(
  databaseUrl: string,
  applicationName: string,
  isCancelling: () => boolean,
  purpose: "fixture" | "migration-administration",
): Database {
  const administration = purpose === "migration-administration";
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: applicationName,
    max: administration ? 1 : 10,
    connectionTimeoutMillis: fixtureIoFailureMilliseconds,
    query_timeout: administration
      ? migrationAdministrationResponseMilliseconds
      : fixtureIoFailureMilliseconds,
    statement_timeout: administration
      ? migrationAdministrationStatementMilliseconds
      : fixtureIoFailureMilliseconds,
    lock_timeout: administration
      ? migrationAdministrationStatementMilliseconds
      : fixtureIoFailureMilliseconds,
  });
  const retired = new WeakSet<PoolClient>();
  pool.on("release", (_error: Error | undefined, client: PoolClient) => {
    if (isCancelling()) {
      retired.add(client);
      // End before pg-pool decides whether this client can return to its idle queue.
      void client.end();
    }
  });
  pool.on("connect", (client) => {
    client.on("error", (error: Error) => {
      // A terminated checked-out connection can be between queries while its transaction owns a lock.
      if (!isCancelling() && !retired.has(client)) throw error;
    });
  });
  pool.on("error", (error: Error, client: PoolClient) => {
    // Terminating this fixture also disconnects idle clients. Other pool errors remain failures.
    if (!isCancelling() && !retired.has(client)) throw error;
  });
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool,
    }),
  });
}
