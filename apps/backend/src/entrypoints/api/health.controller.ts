import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import { toOpenApiSchema } from "../../infrastructure/http/zod-openapi.js";
import {
  OperationalReadiness,
  type ReadinessReport,
} from "../../infrastructure/operational-readiness.js";

const healthResponseSchema = z
  .object({
    process: z.literal("api"),
    status: z.literal("ok"),
    database: z.literal("reachable"),
  })
  .strict();

@ApiTags("Operations")
@Controller()
export class HealthController {
  constructor(
    @Inject(OperationalReadiness)
    private readonly readiness: OperationalReadiness,
  ) {}

  @Get("health")
  @ApiOperation({ operationId: "getApiHealth", summary: "Check API and database readiness" })
  @ApiOkResponse({ description: "The API and PostgreSQL are ready", schema: toOpenApiSchema(healthResponseSchema) })
  check(): Promise<ReadinessReport> {
    return this.readiness.check("api");
  }
}
