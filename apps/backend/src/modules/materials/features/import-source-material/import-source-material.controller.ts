import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../../../config/platform-config.js";
import { z } from "zod";
import { validateSourceBodySchema } from "./import-source-material.contract.js";
import { Body, Controller, Get, Headers, Inject, Post } from "@nestjs/common";
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
} from "@nestjs/swagger";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  ApiMaterialAuthoringErrors,
  MaterialAuthoringEndpoint,
} from "../../adapters/nest/material-authoring-endpoint.js";
import {
  idempotencyKeySchema,
  materialMutationReceiptSchema,
  parseMaterialAuthoringBody,
  throwMaterialAuthoringError,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";
import {
  reserveSourceBodySchema,
  applySourceBodySchema,
} from "./import-source-material.contract.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/import/materials")
export class ImportSourceMaterialController {
  constructor(
    @Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}

  @Get("environment")
  @ApiOperation({
    operationId: "readAuthoringImportEnvironment",
    summary: "Identify the receiving runtime before local synchronization",
  })
  @ApiOkResponse({
    schema: toOpenApiSchema(
      z
        .object({ mode: z.enum(["development", "test", "production"]) })
        .strict(),
    ),
  })
  @ApiMaterialAuthoringErrors(401, 403, 500, 503)
  environment() {
    return { mode: this.config.mode };
  }

  @Post("validate")
  @ApiOperation({
    operationId: "validateSourceContent",
    summary: "Validate source content without applying any mutation",
  })
  @ApiBody({ schema: toOpenApiSchema(validateSourceBodySchema) })
  @ApiOkResponse({
    schema: toOpenApiSchema(z.object({ valid: z.literal(true) }).strict()),
  })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async validate(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(validateSourceBodySchema, input);
    const result = await this.authoring.validateSourceContent({
      actor: account.accountId,
      ...body,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }

  @Post("reserve")
  @ApiOperation({
    operationId: "reserveSourceMaterial",
    summary: "Reserve a stable authoring source identity without publishing",
  })
  @ApiBody({ schema: toOpenApiSchema(reserveSourceBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(materialMutationReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async reserve(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(reserveSourceBodySchema, input);
    const result = await this.authoring.reserveSourceMaterial({
      actor: account.accountId,
      source: body.source,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }

  @Post("apply")
  @ApiOperation({
    operationId: "applySourceMaterial",
    summary:
      "Apply one selected source Material with optimistic version checking",
  })
  @ApiHeader({
    name: "idempotency-key",
    required: true,
    schema: toOpenApiSchema(idempotencyKeySchema),
  })
  @ApiBody({ schema: toOpenApiSchema(applySourceBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(materialMutationReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async apply(
    @CurrentAccount() account: AuthenticatedAccount,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(applySourceBodySchema, input);
    const result = await this.authoring.applySourceMaterial({
      actor: account.accountId,
      idempotencyKey: key ?? "",
      ...body,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
