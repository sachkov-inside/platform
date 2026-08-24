import { Module } from "@nestjs/common";

import { PostgresModule } from "../../infrastructure/postgres/index.js";
import { DATABASE_PROBE } from "./database-probe.js";
import { PlatformDatabaseProbe } from "./platform-database-probe.js";
import { ReadinessService } from "./readiness.service.js";

@Module({
  imports: [PostgresModule],
  providers: [
    {
      provide: DATABASE_PROBE,
      useClass: PlatformDatabaseProbe,
    },
    ReadinessService,
  ],
  exports: [ReadinessService],
})
export class ReadinessModule {}
