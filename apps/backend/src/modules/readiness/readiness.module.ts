import { Module } from "@nestjs/common";

import { readDatabaseConfig } from "../../config/database";
import { DATABASE_PROBE } from "./database-probe";
import { PostgresProbe } from "./postgres-probe";
import { ReadinessService } from "./readiness.service";

@Module({
  providers: [
    {
      provide: DATABASE_PROBE,
      useFactory: () => new PostgresProbe(readDatabaseConfig().url),
    },
    ReadinessService,
  ],
  exports: [ReadinessService],
})
export class ReadinessModule {}
