import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { PrivateNoStore } from "../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../infrastructure/http/zod-openapi.js";
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

const healthUnavailableProblemSchema = z
  .object({
    type: z.literal("about:blank"),
    title: z.literal("Service unavailable"),
    status: z.literal(503),
    code: z.literal("dependency_unavailable"),
  })
  .strict();

@ApiTags("Operations")
@PrivateNoStore()
@Controller()
export class HealthController {
  constructor(
    @Inject(OperationalReadiness)
    private readonly readiness: OperationalReadiness,
  ) {}

  @Get("health")
  @ApiOperation({ operationId: "getApiHealth", summary: "Check API and database readiness" })
  @ApiOkResponse({ description: "The API and PostgreSQL are ready", schema: toOpenApiSchema(healthResponseSchema) })
  @ApiServiceUnavailableResponse({
    description: "PostgreSQL readiness check failed",
    content: problemDetailsContent(healthUnavailableProblemSchema),
  })
  async check(): Promise<ReadinessReport> {
    try {
      return await this.readiness.check("api");
    } catch (cause) {
      throw new ServiceUnavailableException(
        { code: "dependency_unavailable" },
        { cause },
      );
    }
  }
}
