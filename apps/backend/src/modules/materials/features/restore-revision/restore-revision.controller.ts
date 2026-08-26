import { Body, Controller, Headers, Inject, Param, Post } from "@nestjs/common";
import { ApiBody, ApiCreatedResponse, ApiHeader, ApiOperation, ApiParam } from "@nestjs/swagger";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { idempotencyKeySchema, materialIdSchema, materialRevisionSchema, parseMaterialAuthoringBody, restoreRevisionBodySchema, revisionIdSchema, throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class RestoreRevisionController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Post(":materialId/revisions/:revisionId/restore")
  @ApiOperation({ operationId: "restoreMaterialRevision", summary: "Restore a historical revision as a new current draft" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(materialIdSchema) })
  @ApiParam({ name: "revisionId", schema: toOpenApiSchema(revisionIdSchema) })
  @ApiHeader({ name: "idempotency-key", required: true, schema: toOpenApiSchema(idempotencyKeySchema) })
  @ApiBody({ schema: toOpenApiSchema(restoreRevisionBodySchema) })
  @ApiCreatedResponse({ schema: toOpenApiSchema(materialRevisionSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async restore(@CurrentAccount() account: AuthenticatedAccount, @Param("materialId") materialId: string, @Param("revisionId") revisionId: string, @Headers("idempotency-key") idempotencyKey: string | undefined, @Body() input: unknown) {
    const body = parseMaterialAuthoringBody(restoreRevisionBodySchema, input);
    const result = await this.authoring.restoreRevision({ actor: account.accountId, idempotencyKey: idempotencyKey ?? "", materialId, revisionId, baseRevisionId: body.baseRevisionId });
    if (!result.ok) {
      throwMaterialAuthoringError(result.error);
    }
    return result.value;
  }
}
