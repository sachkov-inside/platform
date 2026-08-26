import { Body, Controller, Delete, Headers, Inject, Param } from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiParam } from "@nestjs/swagger";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { idempotencyKeySchema, materialIdSchema, parseMaterialAuthoringBody, publicationEventToHttp, publicationLifecycleEventSchema, throwMaterialAuthoringError, unpublishMaterialBodySchema } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class UnpublishMaterialController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Delete(":materialId/publication")
  @ApiOperation({ operationId: "unpublishMaterial", summary: "Remove the current Material publication" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(materialIdSchema) })
  @ApiHeader({ name: "idempotency-key", required: true, schema: toOpenApiSchema(idempotencyKeySchema) })
  @ApiBody({ schema: toOpenApiSchema(unpublishMaterialBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(publicationLifecycleEventSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 500, 503)
  async unpublish(@CurrentAccount() account: AuthenticatedAccount, @Param("materialId") materialId: string, @Headers("idempotency-key") idempotencyKey: string | undefined, @Body() input: unknown) {
    const body = parseMaterialAuthoringBody(unpublishMaterialBodySchema, input);
    const result = await this.authoring.unpublishMaterial({ actor: account.accountId, idempotencyKey: idempotencyKey ?? "", materialId, expectedPublishedRevisionId: body.expectedPublishedRevisionId });
    if (!result.ok) {
      throwMaterialAuthoringError(result.error);
    }
    return publicationEventToHttp(result.value);
  }
}
