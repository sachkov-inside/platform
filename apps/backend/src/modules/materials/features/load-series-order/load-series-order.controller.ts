import { Controller, Get, Inject, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiParam } from "@nestjs/swagger";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { seriesOrderSchema, throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/series")
export class LoadSeriesOrderController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Get(":seriesId/order")
  @ApiOperation({
    operationId: "loadAuthoringSeriesOrder",
    summary: "Load the current Material order for a Series",
  })
  @ApiParam({ name: "seriesId", schema: { type: "string", format: "uuid" } })
  @ApiOkResponse({ schema: toOpenApiSchema(seriesOrderSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 500, 503)
  async load(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("seriesId") seriesId: string,
  ) {
    const result = await this.authoring.loadSeriesOrder({
      actor: account.accountId,
      seriesId,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
