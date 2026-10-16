import { sql } from "kysely";

import type { Database } from "../../src/database/database.js";
import { createFixtureDatabase } from "./fixture-database.js";

export interface MigrationDatabaseFixture {
  readonly database: Database;
  close(): Promise<void>;
}

/** The name is unique and owned by this check; never pass an existing application database. */
export async function createMigrationDatabase(
  databaseUrl: string,
  databaseName: string,
  options: { signal?: AbortSignal } = {},
): Promise<MigrationDatabaseFixture> {
  options.signal?.throwIfAborted();
  const owner = createFixtureDatabase(databaseUrl, `${databaseName}_owner`);
  let database: Database | undefined;
  let closing = false;
  let acquired = false;
  let cleanup: Promise<void> | undefined;
  const close = (): Promise<void> => {
    cleanup ??= (async () => {
      closing = true;
      options.signal?.removeEventListener("abort", cancel);
      try {
        // Drop first: closing a pool alone waits forever for its blocked transactions.
        if (acquired)
          await sql`drop database if exists ${sql.id(databaseName)} with (force)`.execute(
            owner,
          );
      } finally {
        try {
          await database?.destroy();
        } finally {
          await owner.destroy();
        }
      }
    })();
    return cleanup;
  };
  const cancel = () => {
    // The owning hook joins close; an event listener cannot await this promise.
    void close().catch(() => undefined);
  };
  try {
    await sql`create database ${sql.id(databaseName)}`.execute(owner);
    acquired = true;
    const scopedUrl = new URL(databaseUrl);
    scopedUrl.pathname = `/${databaseName}`;
    database = createFixtureDatabase(
      scopedUrl.toString(),
      databaseName,
      () => closing,
    );
    options.signal?.addEventListener("abort", cancel, { once: true });
    options.signal?.throwIfAborted();
    return { database, close };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Migration fixture acquisition and cleanup failed",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

/** Destructive migration work owns a database and always closes it, including on failure. */
export async function withMigrationDatabase<Result>(
  databaseUrl: string,
  databaseName: string,
  work: (database: Database) => Promise<Result>,
  options: { signal?: AbortSignal } = {},
): Promise<Result> {
  const fixture = await createMigrationDatabase(
    databaseUrl,
    databaseName,
    options,
  );
  let outcome:
    { status: "ok"; value: Result } | { status: "error"; error: unknown };
  try {
    outcome = { status: "ok", value: await work(fixture.database) };
  } catch (error) {
    outcome = { status: "error", error };
  }
  try {
    await fixture.close();
  } catch (cleanupError) {
    if (outcome.status === "error")
      throw new AggregateError(
        [outcome.error, cleanupError],
        "Migration work and cleanup failed",
        { cause: cleanupError },
      );
    throw cleanupError;
  }
  if (outcome.status === "error") throw outcome.error;
  return outcome.value;
}
