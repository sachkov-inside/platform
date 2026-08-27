import { Body, Controller, Delete, Headers, Inject, Param } from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiParam } from "@nestjs/swagger";
import { z } from "zod";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { deleteDraftBodySchema, idempotencyKeySchema, materialIdSchema, parseMaterialAuthoringBody, throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

const deletedMaterialSchema = z.object({ materialId: z.uuid() }).strict();

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class DeleteDraftController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Delete(":materialId")
  @ApiOperation({ operationId: "deleteMaterialDraft", summary: "Delete a never-published Material draft" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(materialIdSchema) })
  @ApiHeader({ name: "idempotency-key", required: true, schema: toOpenApiSchema(idempotencyKeySchema) })
  @ApiBody({ schema: toOpenApiSchema(deleteDraftBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(deletedMaterialSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async delete(@CurrentAccount() account: AuthenticatedAccount, @Param("materialId") materialId: string, @Headers("idempotency-key") idempotencyKey: string | undefined, @Body() input: unknown) {
    const body = parseMaterialAuthoringBody(deleteDraftBodySchema, input);
    const result = await this.authoring.deleteDraft({ actor: account.accountId, idempotencyKey: idempotencyKey ?? "", materialId, expectedContentVersion: body.expectedContentVersion });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
