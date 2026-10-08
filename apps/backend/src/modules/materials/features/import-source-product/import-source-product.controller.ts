import { Body, Controller, Inject, Post } from "@nestjs/common";
import { z } from "zod";
import { ApiBody, ApiOkResponse, ApiOperation } from "@nestjs/swagger";
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
  contentCollectionSchema,
  reorderSeriesReceiptSchema,
  parseMaterialAuthoringBody,
  throwMaterialAuthoringError,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";
import {
  reserveSourceProductBodySchema,
  updateSourceProductBodySchema,
  reorderSourceProductBodySchema,
  validateSourceProductBodySchema,
} from "./import-source-product.contract.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/import/products")
export class ImportSourceProductController {
  constructor(
    @Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring,
  ) {}

  @Post("validate")
  @ApiOperation({
    operationId: "validateSourceProduct",
    summary: "validateSourceProduct",
  })
  @ApiBody({ schema: toOpenApiSchema(validateSourceProductBodySchema) })
  @ApiOkResponse({
    schema: toOpenApiSchema(z.object({ valid: z.literal(true) }).strict()),
  })
  @ApiMaterialAuthoringErrors(400, 401, 403, 422, 500, 503)
  async validate(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(
      validateSourceProductBodySchema,
      input,
    );
    const result = await this.authoring.validateSourceProduct({
      actor: account.accountId,
      ...body,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }

  @Post("reserve")
  @ApiOperation({
    operationId: "reserveSourceProduct",
    summary: "reserveSourceProduct",
  })
  @ApiBody({ schema: toOpenApiSchema(reserveSourceProductBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(contentCollectionSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async reserve(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(
      reserveSourceProductBodySchema,
      input,
    );
    const result = await this.authoring.reserveSourceProduct({
      actor: account.accountId,
      ...body,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }

  @Post("update")
  @ApiOperation({
    operationId: "updateSourceProduct",
    summary: "updateSourceProduct",
  })
  @ApiBody({ schema: toOpenApiSchema(updateSourceProductBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(contentCollectionSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async update(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(
      updateSourceProductBodySchema,
      input,
    );
    const result = await this.authoring.updateSourceProduct({
      actor: account.accountId,
      ...body,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }

  @Post("composition")
  @ApiOperation({
    operationId: "reorderSourceProduct",
    summary: "reorderSourceProduct",
  })
  @ApiBody({ schema: toOpenApiSchema(reorderSourceProductBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(reorderSeriesReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async composition(
    @CurrentAccount() account: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(
      reorderSourceProductBodySchema,
      input,
    );
    const result = await this.authoring.reorderSourceProduct({
      actor: account.accountId,
      ...body,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
