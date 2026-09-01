import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiFoundResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { MaterialAssetDeliveryCache } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent } from "../../../../infrastructure/http/zod-openapi.js";
import {
  accountId as checkedAccountId,
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { anonymousSubject } from "../../../content-access/index.js";
import {
  MATERIAL_ASSET_DELIVERY,
  type MaterialAssetDelivery,
} from "./deliver-material-asset.js";

const uuid = z.uuid();
const assetDeliveryProblemSchema = z.object({
  code: z.enum(["asset_not_found", "dependency_unavailable"]),
  status: z.union([z.literal(404), z.literal(503)]),
  title: z.string(),
  type: z.string(),
}).strict();

@ApiTags("Material assets")
@OptionalAccountEndpoint()
@Controller("materials")
export class DeliverMaterialAssetController {
  constructor(
    @Inject(MATERIAL_ASSET_DELIVERY)
    private readonly delivery: MaterialAssetDelivery,
  ) {}

  @Get(":materialId/assets/:assetId")
  @ApiOperation({ operationId: "downloadMaterialAsset", summary: "Download a file through current Material access" })
  @ApiParam({ name: "materialId", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "assetId", schema: { type: "string", format: "uuid" } })
  @ApiQuery({ name: "contentVersion", required: true, schema: { type: "integer", minimum: 1 } })
  @ApiQuery({ name: "preview", required: false, schema: { type: "boolean" } })
  @ApiProduces("application/octet-stream")
  @ApiOkResponse({ description: "Public immutable file bytes", schema: { type: "string", format: "binary" } })
  @ApiFoundResponse({ description: "Short-lived protected redirect", headers: { Location: { schema: { type: "string", format: "uri" } } } })
  @ApiNotFoundResponse({ description: "Asset is absent or not currently accessible", content: problemDetailsContent(assetDeliveryProblemSchema) })
  @ApiServiceUnavailableResponse({ description: "Access or storage dependency is unavailable", content: problemDetailsContent(assetDeliveryProblemSchema) })
  @MaterialAssetDeliveryCache()
  download(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("materialId") materialId: string,
    @Param("assetId") assetId: string,
    @Query("contentVersion") contentVersion: string | undefined,
    @Query("preview") preview: string | undefined,
  ) {
    return this.send({ account, assetId, contentVersion, materialId, preview });
  }

  @Get(":materialId/assets/:assetId/images/:width")
  @ApiOperation({ operationId: "readMaterialAssetImage", summary: "Read a responsive image through current Material access" })
  @ApiParam({ name: "materialId", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "assetId", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "width", schema: { type: "integer", minimum: 1 } })
  @ApiQuery({ name: "contentVersion", required: true, schema: { type: "integer", minimum: 1 } })
  @ApiQuery({ name: "preview", required: false, schema: { type: "boolean" } })
  @ApiProduces("image/webp")
  @ApiOkResponse({ description: "Public immutable image bytes", schema: { type: "string", format: "binary" } })
  @ApiFoundResponse({ description: "Short-lived protected redirect", headers: { Location: { schema: { type: "string", format: "uri" } } } })
  @ApiNotFoundResponse({ description: "Asset is absent or not currently accessible", content: problemDetailsContent(assetDeliveryProblemSchema) })
  @ApiServiceUnavailableResponse({ description: "Access or storage dependency is unavailable", content: problemDetailsContent(assetDeliveryProblemSchema) })
  @MaterialAssetDeliveryCache()
  image(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("materialId") materialId: string,
    @Param("assetId") assetId: string,
    @Param("width") width: string,
    @Query("contentVersion") contentVersion: string | undefined,
    @Query("preview") preview: string | undefined,
  ) {
    const variantWidth = Number(width);
    return this.send({
      account,
      assetId,
      contentVersion,
      materialId,
      preview,
      variantWidth,
    });
  }

  private async send(input: {
    readonly account: AuthenticatedAccount | undefined;
    readonly assetId: string;
    readonly contentVersion: string | undefined;
    readonly materialId: string;
    readonly preview: string | undefined;
    readonly variantWidth?: number;
  }) {
    const contentVersion = Number(input.contentVersion);
    if (
      !uuid.safeParse(input.materialId).success ||
      !uuid.safeParse(input.assetId).success ||
      !Number.isInteger(contentVersion) ||
      contentVersion < 1 ||
      (input.preview !== undefined && input.preview !== "false" && input.preview !== "true") ||
      (input.variantWidth !== undefined && (!Number.isInteger(input.variantWidth) || input.variantWidth < 1))
    ) throw notFound();
    const result = await this.delivery.deliver({
      assetId: input.assetId,
      contentVersion,
      materialId: input.materialId,
      preview: input.preview === "true",
      subject: input.account === undefined
        ? anonymousSubject
        : { kind: "account", accountId: checkedAccountId(input.account.accountId) },
      ...(input.variantWidth === undefined ? {} : { variantWidth: input.variantWidth }),
    });
    if (!result.ok) {
      if (result.error.code === "dependency_unavailable") {
        throw new ServiceUnavailableException({
          type: "urn:inside:problem:dependency-unavailable",
          title: "Asset dependency unavailable",
          status: 503,
          code: result.error.code,
        });
      }
      throw notFound();
    }
    return result.value;
  }
}

function notFound(): NotFoundException {
  return new NotFoundException({
    type: "urn:inside:problem:asset-not-found",
    title: "Asset not found",
    status: 404,
    code: "asset_not_found",
  });
}
