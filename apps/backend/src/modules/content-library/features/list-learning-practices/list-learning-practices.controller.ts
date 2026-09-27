import { Controller, Get, Inject, Param } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";
import {
  toOpenApiSchema,
  problemDetailsContent,
} from "../../../../infrastructure/http/zod-openapi.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  accountId,
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { anonymousSubject } from "../../../content-access/index.js";
import {
  PUBLISHED_MATERIAL_READER,
  publishedMaterialProblemHttpSchema,
  type PublishedMaterialReader,
} from "../../../materials/index.js";
import { learningPracticeContextVersion } from "../read-learning-practice/read-learning-practice.js";
import { practiceReviewProtocol } from "../read-learning-practice/review-protocol.js";

const descriptorSchema = z
  .object({
    practiceId: z.string(),
    title: z.string(),
    contextVersion: z.hash("sha256"),
    reviewProtocolVersion: z.string(),
  })
  .strict();

@ApiTags("Content library")
@PrivateNoStore()
@OptionalAccountEndpoint()
@Controller("library/materials")
export class ListLearningPracticesController {
  constructor(
    @Inject(PUBLISHED_MATERIAL_READER)
    private readonly reader: PublishedMaterialReader,
  ) {}

  @Get(":slug/practices")
  @ApiOperation({
    operationId: "listLearningPractices",
    summary:
      "List available assignments and their current context versions for a signed-in participant",
  })
  @ApiParam({
    name: "slug",
    schema: toOpenApiSchema(z.string().min(1).max(120)),
  })
  @ApiOkResponse({
    schema: toOpenApiSchema(
      z.object({ practices: z.array(descriptorSchema) }).strict(),
    ),
  })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(publishedMaterialProblemHttpSchema),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(publishedMaterialProblemHttpSchema),
  })
  @ApiResponse({
    status: 409,
    content: problemDetailsContent(publishedMaterialProblemHttpSchema),
  })
  @ApiResponse({
    status: 500,
    content: problemDetailsContent(publishedMaterialProblemHttpSchema),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(publishedMaterialProblemHttpSchema),
  })
  async list(
    @OptionalCurrentAccount() account: AuthenticatedAccount | undefined,
    @Param("slug") materialSlug: string,
  ) {
    const result = await this.reader.listPractices({
      subject:
        account === undefined
          ? anonymousSubject
          : { kind: "account", accountId: accountId(account.accountId) },
      materialSlug,
    });
    if (!result.ok) {
      const error = result.error;
      switch (error.code) {
        case "invalid_request_shape":
          throw problemException(
            400,
            error.code,
            "Practice request is malformed",
          );
        case "practice_not_available":
          throw problemException(404, error.code, "Practice is not available");
        case "practice_context_changed":
        case "practice_context_unavailable":
          throw problemException(
            409,
            error.code,
            "Practice context is not synchronized",
          );
        case "dependency_unavailable":
          throw problemException(
            503,
            error.code,
            "Practice dependency is unavailable",
            { retryable: true },
          );
        case "internal_error":
          throw problemException(500, error.code, "Practice read failed", {
            correlationId: error.correlationId,
          });
      }
    }
    return {
      practices: result.value.map((practice) => ({
        practiceId: practice.practiceId,
        title: practice.definition.title,
        contextVersion: learningPracticeContextVersion(practice),
        reviewProtocolVersion: practiceReviewProtocol.version,
      })),
    };
  }
}
