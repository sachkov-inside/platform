import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation } from "@nestjs/swagger";

import {
  type ReadinessReport,
  ReadinessService,
} from "../../modules/readiness/readiness.service.js";

@Controller()
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get("health")
  @ApiOperation({ summary: "Check API and database readiness" })
  @ApiOkResponse({ description: "The API and PostgreSQL are ready" })
  check(): Promise<ReadinessReport> {
    return this.readiness.check("api");
  }
}
