import { Body, Controller, Headers, Inject, Param, Patch } from "@nestjs/common";
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
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
  idempotencyKeySchema,
  materialIdSchema,
  materialMutationReceiptSchema,
  parseMaterialAuthoringBody,
  throwMaterialAuthoringError,
  transitionMaterialPublicationBodySchema,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/materials")
export class TransitionMaterialPublicationController {
  constructor(
    @Inject(MATERIAL_AUTHORING)
    private readonly authoring: MaterialAuthoring,
  ) {}

  @Patch(":materialId/publication")
  @ApiOperation({
    operationId: "transitionMaterialPublication",
    summary: "Publish or unpublish the current Material without resending its content",
  })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(materialIdSchema) })
  @ApiHeader({
    name: "idempotency-key",
    required: true,
    schema: toOpenApiSchema(idempotencyKeySchema),
  })
  @ApiBody({ schema: toOpenApiSchema(transitionMaterialPublicationBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(materialMutationReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async transition(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("materialId") materialId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(
      transitionMaterialPublicationBodySchema,
      input,
    );
    const result = await this.authoring.transitionPublication({
      actor: account.accountId,
      expectedContentVersion: body.expectedContentVersion,
      idempotencyKey: idempotencyKey ?? "",
      materialId,
      publicationState: body.publicationState,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
