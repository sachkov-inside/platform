import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery } from "@nestjs/swagger";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { contentVersionSchema, materialIdSchema, parseMaterialAuthoringBody, throwMaterialAuthoringError, validatedMaterialSchema } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";
import { z } from "zod";

const validationQuerySchema = z.object({ expectedContentVersion: z.coerce.number().int().positive() }).strict();

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class ValidateMaterialController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Get(":materialId/validation")
  @ApiOperation({ operationId: "validateCurrentMaterial", summary: "Validate the current Material for publication" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(materialIdSchema) })
  @ApiQuery({ name: "expectedContentVersion", schema: toOpenApiSchema(contentVersionSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(validatedMaterialSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async validate(@CurrentAccount() account: AuthenticatedAccount, @Param("materialId") materialId: string, @Query() input: unknown) {
    const query = parseMaterialAuthoringBody(validationQuerySchema, input);
    const result = await this.authoring.validateMaterial({ actor: account.accountId, materialId, expectedContentVersion: query.expectedContentVersion });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
