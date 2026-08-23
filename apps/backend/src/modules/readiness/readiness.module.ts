import { Module } from "@nestjs/common";

import { readDatabaseConfig } from "../../config/database.js";
import { DATABASE_PROBE } from "./database-probe.js";
import { PostgresProbe } from "./postgres-probe.js";
import { ReadinessService } from "./readiness.service.js";

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
