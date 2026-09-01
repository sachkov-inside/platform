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
  setContentCollectionArchiveBodySchema,
  throwMaterialAuthoringError,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/collections")
export class SetContentCollectionArchiveController {
  constructor(
    @Inject(MATERIAL_AUTHORING)
    private readonly authoring: MaterialAuthoring,
  ) {}

  @Put(":collectionId/archive")
  @ApiOperation({
    operationId: "setAuthoringContentCollectionArchive",
    summary: "Archive or restore a Topic or Series",
  })
  @ApiParam({ name: "collectionId", schema: { format: "uuid", type: "string" } })
  @ApiBody({ schema: toOpenApiSchema(setContentCollectionArchiveBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(contentCollectionSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 500, 503)
  async setArchive(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("collectionId") collectionId: string,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(
      setContentCollectionArchiveBodySchema,
      input,
    );
    const result = await this.authoring.setContentCollectionArchive({
      actor: account.accountId,
      collectionId,
      ...body,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
