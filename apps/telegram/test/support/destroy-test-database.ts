import type { Pool } from "pg";
import type { Database } from "../../src/database/database.js";

export async function destroyTestDatabase(
  database: Database,
  owner: Pool,
  name: string,
): Promise<void> {
  await database.destroy();
  // Pool.end() can resolve before its idle clients finish disconnecting.
  // Let PostgreSQL wait for those backends and report live connections instead
  // of terminating a client that is still shutting down with 57P01.
  await owner.query(`DROP DATABASE "${name.replaceAll('"', '""')}"`);
}
