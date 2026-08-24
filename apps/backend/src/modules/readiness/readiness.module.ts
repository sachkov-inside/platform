import { Module } from "@nestjs/common";
import { sql } from "kysely";

import {
  PLATFORM_DATABASE,
  PostgresModule,
  type PlatformDatabase,
} from "../../infrastructure/postgres/index.js";
import { DATABASE_PROBE, type DatabaseProbe } from "./database-probe.js";
import { ReadinessService } from "./readiness.service.js";

@Module({
  imports: [PostgresModule],
  providers: [
    {
      provide: DATABASE_PROBE,
      inject: [PLATFORM_DATABASE],
      useFactory: (database: PlatformDatabase): DatabaseProbe => ({
        async ping(): Promise<void> {
          await sql`select 1`.execute(database);
        },
      }),
    },
    ReadinessService,
  ],
  exports: [ReadinessService],
})
export class ReadinessModule {}
