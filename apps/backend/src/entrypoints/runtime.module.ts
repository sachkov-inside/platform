import { Module } from "@nestjs/common";

import { ReadinessModule } from "../modules/readiness/readiness.module.js";

@Module({
  imports: [ReadinessModule],
})
export class RuntimeModule {}
