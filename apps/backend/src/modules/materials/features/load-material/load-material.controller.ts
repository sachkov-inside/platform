import { Controller, Get, Inject, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiParam } from "@nestjs/swagger";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { materialIdSchema, materialSchema, throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class LoadMaterialController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Get(":materialId")
  @ApiOperation({ operationId: "loadCurrentMaterial", summary: "Load the current saved Material" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(materialIdSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(materialSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 422, 500, 503)
  async load(@CurrentAccount() account: AuthenticatedAccount, @Param("materialId") materialId: string) {
    const result = await this.authoring.loadMaterial({ actor: account.accountId, materialId });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
