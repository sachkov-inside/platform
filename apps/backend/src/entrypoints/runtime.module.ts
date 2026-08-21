import { Module } from "@nestjs/common";

import { ReadinessModule } from "../modules/readiness/readiness.module";

@Module({
  imports: [ReadinessModule],
})
export class RuntimeModule {}
