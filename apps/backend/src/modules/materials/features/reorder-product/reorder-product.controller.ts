import { chapterAttachmentsBodySchema } from "../update-chapter-attachments/update-chapter-attachments.js";
import { Body, Controller, Inject, Param, Put } from "@nestjs/common";
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from "@nestjs/swagger";

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
  reorderProductBodySchema,
  reorderProductReceiptSchema,
  throwMaterialAuthoringError,
} from "../../adapters/nest/material-authoring-http.js";
import { MATERIAL_AUTHORING } from "../../facets/material-authoring/material-authoring.token.js";
import type { MaterialAuthoring } from "../../facets/material-authoring/material-authoring.js";

@MaterialAuthoringEndpoint()
@Controller("authoring")
export class ReorderProductController {
  constructor(
    @Inject(MATERIAL_AUTHORING) private readonly authoring: MaterialAuthoring,
  ) {}

  @Put("products/:productId/order")
  @ApiOperation({
    operationId: "reorderAuthoringProduct",
    summary: "Replace the Material order for a Product",
  })
  @ApiParam({ name: "productId", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: toOpenApiSchema(reorderProductBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(reorderProductReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async reorderProduct(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("productId") productId: string,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(reorderProductBodySchema, input);
    const result = await this.authoring.reorderProduct({
      actor: account.accountId,
      productId,
      ...body,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }

  @Put("products/:productId/chapters/:chapterId/attachments")
  @ApiOperation({
    operationId: "updateAuthoringChapterAttachments",
    summary:
      "Replace chapter reference links without changing the Product catalogue or programme",
  })
  @ApiParam({ name: "productId", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "chapterId", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: toOpenApiSchema(chapterAttachmentsBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(reorderProductReceiptSchema) })
  @ApiMaterialAuthoringErrors(400, 401, 403, 404, 409, 422, 500, 503)
  async attachments(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("productId") productId: string,
    @Param("chapterId") chapterId: string,
    @Body() input: unknown,
  ) {
    const body = parseMaterialAuthoringBody(
      chapterAttachmentsBodySchema,
      input,
    );
    const result = await this.authoring.updateChapterAttachments({
      actor: account.accountId,
      productId,
      chapterId,
      ...body,
    });
    if (!result.ok) throwMaterialAuthoringError(result.error);
    return result.value;
  }
}
