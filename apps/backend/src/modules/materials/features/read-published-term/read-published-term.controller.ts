import { Controller, Get, Inject, Param } from "@nestjs/common";
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
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import { OptionalAccountEndpoint } from "../../../accounts/index.js";
import { materialAuthoringProblemSchema } from "../../adapters/nest/material-authoring-http.js";
import { publishedTermSchema } from "../../domain/term-definition.js";
import { PublishedTermReader } from "./read-published-term.js";

@ApiTags("Published terms")
@OptionalAccountEndpoint()
@PrivateNoStore()
@Controller("terms")
export class ReadPublishedTermController {
  constructor(
    @Inject(PublishedTermReader) private readonly terms: PublishedTermReader,
  ) {}

  @Get(":termId")
  @ApiOperation({
    operationId: "readPublishedTerm",
    summary: "Read the current independently published term definition",
  })
  @ApiParam({ name: "termId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(publishedTermSchema) })
  @ApiBadRequestResponse({
    content: problemDetailsContent(materialAuthoringProblemSchema),
  })
  @ApiNotFoundResponse({
    content: problemDetailsContent(materialAuthoringProblemSchema),
  })
  @ApiServiceUnavailableResponse({
    content: problemDetailsContent(materialAuthoringProblemSchema),
  })
  @ApiInternalServerErrorResponse({
    content: problemDetailsContent(materialAuthoringProblemSchema),
  })
  async read(@Param("termId") termId: string) {
    const result = await this.terms.read(termId);
    if (result.ok) return result.value;
    switch (result.error.code) {
      case "invalid_request_shape":
        throw problemException(400, result.error.code, "Invalid term ID");
      case "term_not_found":
        throw problemException(
          404,
          result.error.code,
          "Published term not found",
        );
      case "dependency_unavailable":
        throw problemException(
          503,
          result.error.code,
          "Term dependency unavailable",
          { retryable: true },
        );
      case "internal_error":
        throw problemException(500, result.error.code, "Term read failed", {
          correlationId: result.error.correlationId,
        });
    }
  }
}
