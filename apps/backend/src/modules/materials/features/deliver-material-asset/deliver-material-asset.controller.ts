import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { z } from "zod";

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
  @ApiQuery({ name: "preview", required: false, schema: { type: "boolean" } })
  @ApiProduces("application/octet-stream")
  @ApiOkResponse({ description: "File bytes or a short-lived protected redirect" })
  @ApiNotFoundResponse({ description: "Asset is absent or not currently accessible" })
  @ApiServiceUnavailableResponse({ description: "Access or storage dependency is unavailable" })
  download(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("materialId") materialId: string,
    @Param("assetId") assetId: string,
    @Query("preview") preview: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    return this.send({ account, assetId, materialId, preview, reply });
  }

  @Get(":materialId/assets/:assetId/images/:width")
  @ApiOperation({ operationId: "readMaterialAssetImage", summary: "Read a responsive image through current Material access" })
  @ApiParam({ name: "materialId", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "assetId", schema: { type: "string", format: "uuid" } })
  @ApiParam({ name: "width", schema: { type: "integer", minimum: 1 } })
  @ApiQuery({ name: "preview", required: false, schema: { type: "boolean" } })
  @ApiProduces("image/webp")
  @ApiOkResponse({ description: "Image bytes or a short-lived protected redirect" })
  image(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("materialId") materialId: string,
    @Param("assetId") assetId: string,
    @Param("width") width: string,
    @Query("preview") preview: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const variantWidth = Number(width);
    return this.send({ account, assetId, materialId, preview, reply, variantWidth });
  }

  private async send(input: {
    readonly account: AuthenticatedAccount | undefined;
    readonly assetId: string;
    readonly materialId: string;
    readonly preview: string | undefined;
    readonly reply: FastifyReply;
    readonly variantWidth?: number;
  }) {
    if (
      !uuid.safeParse(input.materialId).success ||
      !uuid.safeParse(input.assetId).success ||
      (input.variantWidth !== undefined && (!Number.isInteger(input.variantWidth) || input.variantWidth < 1))
    ) throw notFound();
    const result = await this.delivery.deliver({
      assetId: input.assetId,
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
    input.reply.header("X-Content-Type-Options", "nosniff");
    input.reply.header(
      "Cache-Control",
      result.value.cacheScope === "public-immutable"
        ? "public, max-age=31536000, immutable"
        : "private, no-store",
    );
    if (result.value.kind === "redirect") {
      return input.reply.redirect(result.value.location, 302);
    }
    input.reply.header("Content-Type", result.value.contentType);
    input.reply.header("Content-Length", String(result.value.contentLength));
    if (result.value.contentDisposition !== undefined) {
      input.reply.header("Content-Disposition", result.value.contentDisposition);
    }
    return input.reply.send(Buffer.from(result.value.body));
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
