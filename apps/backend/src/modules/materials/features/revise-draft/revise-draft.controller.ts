import { Body, Controller, Headers, Inject, Param, Post } from "@nestjs/common";
import { ApiBody, ApiCreatedResponse, ApiHeader, ApiOperation, ApiParam } from "@nestjs/swagger";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { idempotencyKeySchema, materialIdSchema, materialRevisionSchema, parseMaterialAuthoringBody, reviseDraftBodySchema, throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class ReviseDraftController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Post(":materialId/revisions")
  @ApiOperation({ operationId: "reviseMaterialDraft", summary: "Create an immutable revision from the current draft" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(materialIdSchema) })
  @ApiHeader({ name: "idempotency-key", required: true, schema: toOpenApiSchema(idempotencyKeySchema) })
  @ApiBody({ schema: toOpenApiSchema(reviseDraftBodySchema) })
  @ApiCreatedResponse({ schema: toOpenApiSchema(materialRevisionSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async revise(@CurrentAccount() account: AuthenticatedAccount, @Param("materialId") materialId: string, @Headers("idempotency-key") idempotencyKey: string | undefined, @Body() input: unknown) {
    const body = parseMaterialAuthoringBody(reviseDraftBodySchema, input);
    const result = await this.authoring.reviseDraft({
      actor: account.accountId,
      idempotencyKey: idempotencyKey ?? "",
      materialId,
      baseRevisionId: body.baseRevisionId,
      changes: {
        ...(body.changes.metadata === undefined
          ? {}
          : {
              metadata: {
                ...(body.changes.metadata.title === undefined ? {} : { title: body.changes.metadata.title }),
                ...(body.changes.metadata.summary === undefined ? {} : { summary: body.changes.metadata.summary }),
                ...(body.changes.metadata.slug === undefined ? {} : { slug: body.changes.metadata.slug }),
                ...(body.changes.metadata.access === undefined ? {} : { access: body.changes.metadata.access }),
                ...(body.changes.metadata.topicId === undefined ? {} : { topicId: body.changes.metadata.topicId }),
                ...(body.changes.metadata.formatId === undefined ? {} : { formatId: body.changes.metadata.formatId }),
                ...(body.changes.metadata.tagIds === undefined ? {} : { tagIds: body.changes.metadata.tagIds }),
                ...(body.changes.metadata.seriesMemberships === undefined
                  ? {}
                  : { seriesMemberships: body.changes.metadata.seriesMemberships }),
              },
            }),
        ...(body.changes.body === undefined ? {} : { body: body.changes.body }),
      },
    });
    if (!result.ok) {
      throwMaterialAuthoringError(result.error);
    }
    return result.value;
  }
}
