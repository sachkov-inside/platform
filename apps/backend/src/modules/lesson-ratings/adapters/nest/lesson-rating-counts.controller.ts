import { Controller, Get, Inject, Param } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from "@nestjs/swagger";
import { z } from "zod";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  ApiAccountErrors,
  AuthoringEndpoint,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { lessonRatingCountsSchema } from "../../domain/lesson-rating.js";
import { LessonRatings } from "../../facets/lesson-ratings/lesson-ratings.js";

/** Likes and dislikes of one lesson for its author (#2124). */
@AuthoringEndpoint()
@Controller("authoring/materials")
export class LessonRatingCountsController {
  constructor(@Inject(LessonRatings) private readonly ratings: LessonRatings) {}

  @Get(":materialId/ratings")
  @ApiOperation({
    operationId: "countLessonRatings",
    summary:
      "Count the current likes and dislikes of a lesson. Requires materials:manage",
  })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(lessonRatingCountsSchema) })
  @ApiAccountErrors(401, 500)
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request"]),
    ),
  })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      problemDetailsSchema(503, ["dependency_unavailable"]),
    ),
  })
  async count(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("materialId") materialId: string,
  ) {
    const result = await this.ratings.countRatings({
      actor: current.accountId,
      materialId,
    });
    if (!result.ok) {
      switch (result.error.code) {
        case "invalid_request":
          throw problemException(400, "invalid_request", "Invalid request");
        case "forbidden":
          throw problemException(403, "forbidden", "Ratings are forbidden");
        case "dependency_unavailable":
          throw problemException(
            503,
            "dependency_unavailable",
            "Ratings are unavailable",
          );
      }
    }
    return { likes: result.value.likes, dislikes: result.value.dislikes };
  }
}
