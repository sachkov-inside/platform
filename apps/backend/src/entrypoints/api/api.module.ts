import { Module } from "@nestjs/common";

import { ReadinessModule } from "../../modules/readiness/readiness.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [ReadinessModule],
  controllers: [HealthController],
})
export class ApiModule {}
