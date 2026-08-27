import { Body, Controller, Headers, Inject, Post } from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
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
  createDraftBodySchema,
  idempotencyKeySchema,
  materialMutationReceiptSchema,
  parseMaterialAuthoringBody,
  throwMaterialAuthoringError,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class CreateDraftController {
  constructor(
    @Inject(MATERIAL_AUTHORING)
    private readonly authoring: MaterialAuthoring,
  ) {}

  @Post()
  @ApiOperation({
    operationId: "createMaterialDraft",
    summary: "Create one current Material draft",
  })
  @ApiHeader({
    name: "idempotency-key",
    required: true,
    schema: toOpenApiSchema(idempotencyKeySchema),
  })
  @ApiBody({ schema: toOpenApiSchema(createDraftBodySchema) })
  @ApiCreatedResponse({ schema: toOpenApiSchema(materialMutationReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 409, 422, 500, 503)
  async create(
    @CurrentAccount() account: AuthenticatedAccount,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(createDraftBodySchema, input);
    const result = await this.authoring.createDraft({
      actor: account.accountId,
      idempotencyKey: idempotencyKey ?? "",
      metadata: body.metadata,
      body: body.body,
    });
    if (!result.ok) {
      throwMaterialAuthoringError(result.error);
    }
    return result.value;
  }
}
