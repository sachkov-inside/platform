import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery } from "@nestjs/swagger";
import { z } from "zod";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import {
  ApiMaterialAuthoringErrors,
  MaterialAuthoringEndpoint,
} from "../../adapters/nest/material-authoring-endpoint.js";
import {
  contentCollectionListSchema,
  parseMaterialAuthoringBody,
  throwMaterialAuthoringError,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

const querySchema = z.object({ kind: z.enum(["series", "topic"]) }).strict();

@MaterialAuthoringEndpoint()
@Controller("authoring/collections")
export class ListContentCollectionsController {
  constructor(
    @Inject(MATERIAL_AUTHORING)
    private readonly authoring: MaterialAuthoring,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "listAuthoringContentCollections",
    summary: "List Topics or Series for authoring",
  })
  @ApiQuery({ name: "kind", schema: { enum: ["series", "topic"] } })
  @ApiOkResponse({ schema: toOpenApiSchema(contentCollectionListSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 500, 503)
  async list(
    @CurrentAccount() account: AuthenticatedAccount,
    @Query("kind") kind: unknown,
  ) {
    const query = parseMaterialAuthoringBody(querySchema, { kind });
    const result = await this.authoring.listContentCollections({
      actor: account.accountId,
      kind: query.kind,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
