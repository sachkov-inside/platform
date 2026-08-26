import { Controller, Get, Inject, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiParam } from "@nestjs/swagger";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { materialIdSchema, previewRevisionSchema, revisionIdSchema, throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class PreviewRevisionController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Get(":materialId/revisions/:revisionId/preview")
  @ApiOperation({ operationId: "previewMaterialRevision", summary: "Render an exact private Preview of a Material revision" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(materialIdSchema) })
  @ApiParam({ name: "revisionId", schema: toOpenApiSchema(revisionIdSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(previewRevisionSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 422, 500, 503)
  async preview(@CurrentAccount() account: AuthenticatedAccount, @Param("materialId") materialId: string, @Param("revisionId") revisionId: string) {
    const result = await this.authoring.previewRevision({ actor: account.accountId, materialId, revisionId });
    if (!result.ok) {
      throwMaterialAuthoringError(result.error);
    }
    return result.value;
  }
}
