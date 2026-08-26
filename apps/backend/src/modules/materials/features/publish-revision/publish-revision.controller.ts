import { Body, Controller, Headers, Inject, Param, Put } from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiParam } from "@nestjs/swagger";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { idempotencyKeySchema, materialIdSchema, parseMaterialAuthoringBody, publicationEventToHttp, publicationLifecycleEventSchema, publishRevisionBodySchema, throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class PublishRevisionController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Put(":materialId/publication")
  @ApiOperation({ operationId: "publishMaterialRevision", summary: "Publish an owner-approved Material revision" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(materialIdSchema) })
  @ApiHeader({ name: "idempotency-key", required: true, schema: toOpenApiSchema(idempotencyKeySchema) })
  @ApiBody({ schema: toOpenApiSchema(publishRevisionBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(publicationLifecycleEventSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async publish(@CurrentAccount() account: AuthenticatedAccount, @Param("materialId") materialId: string, @Headers("idempotency-key") idempotencyKey: string | undefined, @Body() input: unknown) {
    const body = parseMaterialAuthoringBody(publishRevisionBodySchema, input);
    const result = await this.authoring.publishRevision({ actor: account.accountId, idempotencyKey: idempotencyKey ?? "", materialId, revisionId: body.revisionId, expectedPublishedRevisionId: body.expectedPublishedRevisionId });
    if (!result.ok) {
      throwMaterialAuthoringError(result.error);
    }
    return publicationEventToHttp(result.value);
  }
}
