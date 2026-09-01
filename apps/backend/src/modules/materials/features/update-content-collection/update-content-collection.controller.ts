import { Body, Controller, Inject, Param, Put } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam } from "@nestjs/swagger";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import {
  ApiMaterialAuthoringErrors,
  MaterialAuthoringEndpoint,
} from "../../adapters/nest/material-authoring-endpoint.js";
import {
  contentCollectionSchema,
  parseMaterialAuthoringBody,
  throwMaterialAuthoringError,
  updateContentCollectionBodySchema,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/collections")
export class UpdateContentCollectionController {
  constructor(
    @Inject(MATERIAL_AUTHORING)
    private readonly authoring: MaterialAuthoring,
  ) {}

  @Put(":collectionId")
  @ApiOperation({
    operationId: "updateAuthoringContentCollection",
    summary: "Update Topic or Series metadata without changing its slug",
  })
  @ApiParam({ name: "collectionId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(updateContentCollectionBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(contentCollectionSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async update(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("collectionId") collectionId: string,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(
      updateContentCollectionBodySchema,
      input,
    );
    const result = await this.authoring.updateContentCollection({
      actor: account.accountId,
      collectionId,
      ...body,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
