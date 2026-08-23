import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

import type { DB } from "./generated/database.js";
import type { PlatformDatabase } from "./platform-database.js";

export function createPlatformDatabase(connectionString: string): PlatformDatabase {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString }),
    }),
  });
}
