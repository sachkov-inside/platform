import { Body, Controller, Inject, Post } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation } from "@nestjs/swagger";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { CurrentAccount, type AuthenticatedAccount } from "../../../accounts/index.js";
import { ApiMaterialAuthoringErrors, MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { contentCollectionSchema, reorderSeriesReceiptSchema, parseMaterialAuthoringBody, throwMaterialAuthoringError } from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";
import { archiveSourceGuideBodySchema, reserveSourceGuideBodySchema, updateSourceGuideBodySchema, reorderSourceGuideBodySchema } from "./import-source-guide.contract.js";

@MaterialAuthoringEndpoint()
@Controller("authoring/import/guides")
export class ImportSourceGuideController {
  constructor(@Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring) {}

  @Post("reserve")
  @ApiOperation({ operationId: "reserveSourceGuide", summary: "reserveSourceGuide" })
  @ApiBody({ schema: toOpenApiSchema(reserveSourceGuideBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(contentCollectionSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async reserve(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const body = parseMaterialAuthoringBody(reserveSourceGuideBodySchema, input);
    const result = await this.authoring.reserveSourceGuide({ actor: account.accountId, ...body });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }

  @Post("update")
  @ApiOperation({ operationId: "updateSourceGuide", summary: "updateSourceGuide" })
  @ApiBody({ schema: toOpenApiSchema(updateSourceGuideBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(contentCollectionSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async update(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const body = parseMaterialAuthoringBody(updateSourceGuideBodySchema, input);
    const result = await this.authoring.updateSourceGuide({ actor: account.accountId, ...body });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }

  @Post("archive")
  @ApiOperation({ operationId: "archiveSourceGuide", summary: "archiveSourceGuide" })
  @ApiBody({ schema: toOpenApiSchema(archiveSourceGuideBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(contentCollectionSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async archive(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const body = parseMaterialAuthoringBody(archiveSourceGuideBodySchema, input);
    const result = await this.authoring.archiveSourceGuide({ actor: account.accountId, ...body });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }

  @Post("composition")
  @ApiOperation({ operationId: "reorderSourceGuide", summary: "reorderSourceGuide" })
  @ApiBody({ schema: toOpenApiSchema(reorderSourceGuideBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(reorderSeriesReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async composition(@CurrentAccount() account: AuthenticatedAccount, @Body() input: unknown) {
    const body = parseMaterialAuthoringBody(reorderSourceGuideBodySchema, input);
    const result = await this.authoring.reorderSourceGuide({ actor: account.accountId, ...body });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
