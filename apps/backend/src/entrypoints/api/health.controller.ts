import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation } from "@nestjs/swagger";

import {
  OperationalReadiness,
  type ReadinessReport,
} from "../../infrastructure/operational-readiness.js";

@Controller()
export class HealthController {
  constructor(private readonly readiness: OperationalReadiness) {}

  @Get("health")
  @ApiOperation({ summary: "Check API and database readiness" })
  @ApiOkResponse({ description: "The API and PostgreSQL are ready" })
  check(): Promise<ReadinessReport> {
    return this.readiness.check("api");
  }
}
