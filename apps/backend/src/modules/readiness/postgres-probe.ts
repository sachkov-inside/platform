import type { OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";

import type { DatabaseProbe } from "./database-probe";

export class PostgresProbe implements DatabaseProbe, OnModuleDestroy {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 2 });
  }

  async ping(): Promise<void> {
    await this.pool.query("select 1");
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
