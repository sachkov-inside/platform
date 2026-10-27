import { Controller, Get, Inject, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiParam } from "@nestjs/swagger";

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
  productOrderSchema,
  throwMaterialAuthoringError,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring")
export class LoadProductOrderController {
  constructor(
    @Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring,
  ) {}

  @Get("products/:productId/order")
  @ApiOperation({
    operationId: "loadAuthoringProductOrder",
    summary: "Load the current Material order for a Product",
  })
  @ApiParam({ name: "productId", schema: { type: "string", format: "uuid" } })
  @ApiOkResponse({ schema: toOpenApiSchema(productOrderSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 500, 503)
  async loadProduct(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("productId") productId: string,
  ) {
    const result = await this.authoring.loadProductOrder({
      actor: account.accountId,
      productId,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
