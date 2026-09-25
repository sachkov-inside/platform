import {
  Controller,
  Get,
  Inject,
  Param,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { PublishedMaterialCache } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  publishedMaterialProblemHttpSchema,
  publishedMaterialReadHttpSchema,
} from "../../adapters/nest/published-material-http.js";
import {
  accountId as checkedAccountId,
  accountProblemSchema,
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { anonymousSubject } from "../../../content-access/index.js";
import {
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
} from "../../facets/published-material-reader/published-material-reader.js";
import type { PublishedMaterialReadError } from "./read-published-material.contract.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";

@ApiTags("Published materials")
@PublishedMaterialCache()
@OptionalAccountEndpoint()
@Controller("materials")
export class ReadPublishedMaterialController {
  constructor(
    @Inject(PUBLISHED_MATERIAL_READER)
    private readonly publishedMaterials: PublishedMaterialReader,
  ) {}

  @Get(":slug")
  @ApiOperation({ operationId: "readPublishedMaterial", summary: "Read the current published Material" })
  @ApiParam({ name: "slug", schema: toOpenApiSchema(z.string().min(1).max(120)) })
  @ApiOkResponse({ description: "Published Material body or an access-safe teaser", schema: toOpenApiSchema(publishedMaterialReadHttpSchema) })
  @ApiBadRequestResponse({ description: "Published Material request is malformed", content: problemDetailsContent(publishedMaterialProblemHttpSchema) })
  @ApiNotFoundResponse({ description: "Published Material does not exist", content: problemDetailsContent(publishedMaterialProblemHttpSchema) })
  @ApiServiceUnavailableResponse({ description: "Published Material or Account proof dependency is unavailable", content: problemDetailsOneOfContent(publishedMaterialProblemHttpSchema, accountProblemSchema) })
  @ApiInternalServerErrorResponse({ description: "Published Material read or Account resolution failed unexpectedly", content: problemDetailsOneOfContent(publishedMaterialProblemHttpSchema, accountProblemSchema) })
  async read(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("slug") slug: string,
  ) {
    const result = await this.publishedMaterials.read({
      subject:
        account === undefined
          ? anonymousSubject
          : {
              kind: "account",
              accountId: checkedAccountId(account.accountId),
            },
      slug,
    });
    if (!result.ok) {
      throwReadPublishedMaterialError(result.error);
    }
    return result.value;
  }
}

export function throwReadPublishedMaterialError(
  error: PublishedMaterialReadError,
): never {
  switch (error.code) {
    case "invalid_request_shape":
      throw problemException(400, error.code, "Invalid request shape");
    case "material_not_found":
      throw problemException(404, error.code, "Material not found");
    case "dependency_unavailable":
      throw problemException(503, error.code, "Dependency unavailable", { retryable: error.retryable });
    case "internal_error":
      throw problemException(500, error.code, "Internal error", { correlationId: error.correlationId });
  }
}
