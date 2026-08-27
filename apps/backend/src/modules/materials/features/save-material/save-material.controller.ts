import { Body, Controller, Headers, Inject, Param, Put } from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiParam } from "@nestjs/swagger";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { idempotencyKeySchema, materialIdSchema, materialMutationReceiptSchema, parseMaterialAuthoringBody, saveMaterialBodySchema, throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class SaveMaterialController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Put(":materialId")
  @ApiOperation({ operationId: "saveCurrentMaterial", summary: "Atomically Save the complete current Material state" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(materialIdSchema) })
  @ApiHeader({ name: "idempotency-key", required: true, schema: toOpenApiSchema(idempotencyKeySchema) })
  @ApiBody({ schema: toOpenApiSchema(saveMaterialBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(materialMutationReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async save(@CurrentAccount() account: AuthenticatedAccount, @Param("materialId") materialId: string, @Headers("idempotency-key") idempotencyKey: string | undefined, @Body() input: unknown) {
    const body = parseMaterialAuthoringBody(saveMaterialBodySchema, input);
    const result = await this.authoring.saveMaterial({ actor: account.accountId, idempotencyKey: idempotencyKey ?? "", materialId, ...body });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
