import {
  Controller,
  Get,
  Inject,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";

import {
  anonymousSubject,
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReadError,
  type PublishedMaterialReader,
} from "../../modules/materials/index.js";

@Controller("materials")
export class PublishedMaterialsController {
  constructor(
    @Inject(PUBLISHED_MATERIAL_READER)
    private readonly publishedMaterials: PublishedMaterialReader,
  ) {}

  @Get(":slug")
  @ApiOperation({ summary: "Read the current published Material revision" })
  @ApiParam({ name: "slug" })
  @ApiOkResponse({ description: "Published Material body or an access-safe teaser" })
  @ApiNotFoundResponse({ description: "Published Material does not exist" })
  @ApiServiceUnavailableResponse({ description: "Published Material dependency is unavailable" })
  async read(
    @Param("slug") slug: string,
    @Res({ passthrough: true }) response: FastifyReply,
  ) {
    const result = await this.publishedMaterials.read({
      subject: anonymousSubject,
      slug,
    });
    if (!result.ok) {
      throwPublishedMaterialError(result.error);
    }

    response.header(
      "Cache-Control",
      result.value.cacheScope === "public"
        ? "public, max-age=0, must-revalidate"
        : "private, no-store",
    );
    return result.value;
  }
}

function throwPublishedMaterialError(error: PublishedMaterialReadError): never {
  switch (error.code) {
    case "material_not_found":
      throw new NotFoundException(error);
    case "dependency_unavailable":
      throw new ServiceUnavailableException(error);
    case "internal_error":
      throw new InternalServerErrorException(error);
  }
}
