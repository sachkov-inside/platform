import { Body, Controller, Inject, Param, Put } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam } from "@nestjs/swagger";

import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import {
  parseMaterialAuthoringBody,
  reorderSeriesBodySchema,
  reorderSeriesReceiptSchema,
  throwMaterialAuthoringError,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/series")
export class ReorderSeriesController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Put(":seriesId/order")
  @ApiOperation({
    operationId: "reorderAuthoringSeries",
    summary: "Replace the Material order for a Series",
  })
  @ApiParam({ name: "seriesId", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: toOpenApiSchema(reorderSeriesBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(reorderSeriesReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async reorder(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("seriesId") seriesId: string,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(reorderSeriesBodySchema, input);
    const result = await this.authoring.reorderSeries({
      actor: account.accountId,
      seriesId,
      ...body,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
