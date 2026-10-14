import { sql } from "kysely";

import { createDatabase } from "../../src/database/create-database.js";
import type { Database } from "../../src/database/database.js";

/** Destructive migration checks own a database, never the runtime fixture's tables. */
export async function withMigrationDatabase<Result>(
  databaseUrl: string,
  databaseName: string,
  work: (database: Database) => Promise<Result>,
): Promise<Result> {
  const owner = createDatabase(databaseUrl);
  try {
    await sql`create database ${sql.id(databaseName)}`.execute(owner);
    try {
      const scopedUrl = new URL(databaseUrl);
      scopedUrl.pathname = `/${databaseName}`;
      const database = createDatabase(scopedUrl.toString());
      try {
        return await work(database);
      } finally {
        await database.destroy();
      }
    } finally {
      await sql`drop database ${sql.id(databaseName)}`.execute(owner);
    }
  } finally {
    await owner.destroy();
  }
}
