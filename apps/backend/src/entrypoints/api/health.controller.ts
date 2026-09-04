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
import {
  runtimeIdentitySchema,
  sha256IdentitySchema,
} from "@inside/runtime-identity";
import { z } from "zod";

import { PrivateNoStore } from "../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../infrastructure/http/zod-openapi.js";
import {
  type LivenessReport,
  OperationalReadiness,
  type ReadinessReport,
} from "../../infrastructure/operational-readiness.js";

const schemaIdentitySchema = z.object({
  identity: sha256IdentitySchema,
  migrationCount: z.number().int().nonnegative(),
}).strict();
const livenessResponseSchema = z
  .object({
    process: z.literal("api"),
    status: z.literal("alive"),
    release: runtimeIdentitySchema,
  })
  .strict();
const readinessResponseSchema = z
  .object({
    process: z.literal("api"),
    status: z.literal("ready"),
    database: z.literal("reachable"),
    release: runtimeIdentitySchema,
    schema: schemaIdentitySchema,
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

  @Get("health/live")
  @ApiOperation({ operationId: "getApiLiveness", summary: "Check the API process identity" })
  @ApiOkResponse({ description: "The expected API process is alive", schema: toOpenApiSchema(livenessResponseSchema) })
  live(): LivenessReport {
    return this.readiness.live("api");
  }

  @Get("health")
  @ApiOperation({ operationId: "getApiHealth", summary: "Check API release and schema readiness" })
  @ApiOkResponse({ description: "The API release and PostgreSQL schema are ready", schema: toOpenApiSchema(readinessResponseSchema) })
  @ApiServiceUnavailableResponse({
    description: "PostgreSQL or schema readiness failed",
    content: problemDetailsContent(healthUnavailableProblemSchema),
  })
  async check(): Promise<ReadinessReport> {
    return this.ready();
  }

  @Get("health/ready")
  @ApiOperation({ operationId: "getApiReadiness", summary: "Check API release and schema readiness" })
  @ApiOkResponse({ description: "The API release and PostgreSQL schema are ready", schema: toOpenApiSchema(readinessResponseSchema) })
  @ApiServiceUnavailableResponse({
    description: "PostgreSQL or schema readiness failed",
    content: problemDetailsContent(healthUnavailableProblemSchema),
  })
  async ready(): Promise<ReadinessReport> {
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
