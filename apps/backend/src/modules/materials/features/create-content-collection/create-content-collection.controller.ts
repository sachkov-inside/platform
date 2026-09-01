import { Body, Controller, Inject, Post } from "@nestjs/common";
import { ApiBody, ApiCreatedResponse, ApiOperation } from "@nestjs/swagger";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import {
  ApiMaterialAuthoringErrors,
  MaterialAuthoringEndpoint,
} from "../../adapters/nest/material-authoring-endpoint.js";
import {
  contentCollectionSchema,
  createContentCollectionBodySchema,
  parseMaterialAuthoringBody,
  throwMaterialAuthoringError,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/collections")
export class CreateContentCollectionController {
  constructor(
    @Inject(MATERIAL_AUTHORING)
    private readonly authoring: MaterialAuthoring,
  ) {}

  @Post()
  @ApiOperation({
    operationId: "createAuthoringContentCollection",
    summary: "Create a Topic or Series with an immutable slug",
  })
  @ApiBody({ schema: toOpenApiSchema(createContentCollectionBodySchema) })
  @ApiCreatedResponse({ schema: toOpenApiSchema(contentCollectionSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 409, 422, 500, 503)
  async create(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(
      createContentCollectionBodySchema,
      input,
    );
    const result = await this.authoring.createContentCollection({
      actor: account.accountId,
      ...body,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
