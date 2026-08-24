import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";

import {
  PLATFORM_DATABASE,
  type PlatformDatabase,
} from "../../infrastructure/postgres/index.js";
import type { DatabaseProbe } from "./database-probe.js";

@Injectable()
export class PlatformDatabaseProbe implements DatabaseProbe {
  constructor(
    @Inject(PLATFORM_DATABASE)
    readonly database: PlatformDatabase,
  ) {}

  async ping(): Promise<void> {
    await sql`select 1`.execute(this.database);
  }
}
