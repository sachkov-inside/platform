import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiQuery } from "@nestjs/swagger";

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
  parseMaterialAuthoringBody,
  throwMaterialAuthoringError,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";
import {
  readSourceMaterialStateQuerySchema,
  sourceMaterialStateSchema,
} from "./read-source-material-state.contract.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/import/materials")
export class ReadSourceMaterialStateController {
  constructor(
    @Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring,
  ) {}

  @Get("state")
  @ApiOperation({
    operationId: "readSourceMaterialState",
    summary:
      "Read every source-owned Material of one source namespace in one snapshot",
  })
  @ApiQuery({
    name: "namespace",
    required: true,
    schema: toOpenApiSchema(readSourceMaterialStateQuerySchema.shape.namespace),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(sourceMaterialStateSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 500, 503)
  async read(
    @CurrentAccount() account: AuthenticatedAccount,
    @Query("namespace") namespace: unknown,
  ) {
    const query = parseMaterialAuthoringBody(
      readSourceMaterialStateQuerySchema,
      { namespace },
    );
    const result = await this.authoring.readSourceMaterialState({
      actor: account.accountId,
      namespace: query.namespace,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
