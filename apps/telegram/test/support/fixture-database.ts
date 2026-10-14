import { Kysely, PostgresDialect } from "kysely";
import { Pool, type PoolClient } from "pg";

import type { Database, DatabaseSchema } from "../../src/database/database.js";

// Bound a stuck fixture connection/query within the existing case and cleanup budgets.
const fixtureIoFailureMilliseconds = 5_000;

export function createFixtureDatabase(
  databaseUrl: string,
  applicationName: string,
  isCancelling: () => boolean = () => false,
): Database {
  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: applicationName,
    max: 10,
    connectionTimeoutMillis: fixtureIoFailureMilliseconds,
    query_timeout: fixtureIoFailureMilliseconds,
    statement_timeout: fixtureIoFailureMilliseconds,
    lock_timeout: fixtureIoFailureMilliseconds,
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
