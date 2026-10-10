import { sql } from "kysely";
import { expect, vi } from "vitest";
import type { Database } from "../../src/database/database.js";

/** PostgreSQL has received the operation and reports it waiting for this exact lock. */
export async function advisoryLockWaiting(
  database: Database,
  key: string,
): Promise<void> {
  await vi.waitFor(
    async () => {
      const waiting = await sql<{ waiting: boolean }>`
      select exists (
        select 1 from pg_locks
        where locktype = 'advisory' and not granted and objsubid = 1
          and database = (select oid from pg_database where datname = current_database())
          and classid::bigint = ((hashtextextended(${key}, 0) >> 32) & 4294967295)
          and objid::bigint = (hashtextextended(${key}, 0) & 4294967295)
      ) as waiting
    `.execute(database);
      expect(waiting.rows[0]?.waiting).toBe(true);
    },
    { timeout: 5000 },
  );
}
