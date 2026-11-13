import {
  Body,
  Controller,
  Delete,
  Get,
  type HttpException,
  Inject,
  Param,
  Put,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  problemDetailsSchema,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  AccountProblemDetailsFilter,
  CurrentAccount,
  accountProblemSchema,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { lessonRatingSchema } from "../../domain/lesson-rating.js";
import { LessonRatings } from "../../facets/lesson-ratings/lesson-ratings.js";
import type { RateLessonError } from "../../features/rate-lesson/rate-lesson.js";

/** The request names the rating only: the Account belongs to the session. */
const rateBodySchema = z.object({ rating: lessonRatingSchema }).strict();
const ratingResponseSchema = z
  .object({ rating: lessonRatingSchema.nullable() })
  .strict();

@ApiTags("Lesson Ratings")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
@ApiResponse({
  status: 400,
  content: problemDetailsOneOfContent(
    problemDetailsSchema(400, ["invalid_request"]),
    accountProblemSchema,
  ),
})
@ApiResponse({
  status: 401,
  content: problemDetailsContent(accountProblemSchema),
})
@ApiResponse({
  status: 500,
  content: problemDetailsContent(accountProblemSchema),
})
@ApiResponse({
  status: 503,
  content: problemDetailsOneOfContent(
    problemDetailsSchema(503, ["dependency_unavailable"]),
    accountProblemSchema,
  ),
})
@Controller("lesson-ratings/materials/:materialId")
export class LessonRatingsController {
  constructor(@Inject(LessonRatings) private readonly ratings: LessonRatings) {}

  @Get()
  @ApiOperation({
    operationId: "readLessonRating",
    summary: "Read the current Account's rating of a lesson",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(ratingResponseSchema) })
  async read(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("materialId") materialId: string,
  ) {
    const result = await this.ratings.readRating({
      accountId: current.accountId,
      materialId,
    });
    if (!result.ok) throwRatingError(result.error);
    return { rating: result.value };
  }

  @Put()
  @ApiOperation({
    operationId: "rateLesson",
    summary:
      "Set the current Account's like or dislike of a lesson it may read; replaces the previous one",
  })
  @ApiBody({ schema: toOpenApiSchema(rateBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(ratingResponseSchema) })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(
      problemDetailsSchema(403, ["access_denied"]),
    ),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["material_not_found"]),
    ),
  })
  async rate(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("materialId") materialId: string,
    @Body() input: unknown,
  ) {
    const parsed = rateBodySchema.safeParse(input);
    if (!parsed.success) throwRatingError({ code: "invalid_request" });
    const result = await this.ratings.rate({
      accountId: current.accountId,
      materialId,
      rating: parsed.data.rating,
    });
    if (!result.ok) throwRatingError(result.error);
    return { rating: result.value };
  }

  @Delete()
  @ApiOperation({
    operationId: "clearLessonRating",
    summary: "Remove the current Account's rating of a lesson",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(ratingResponseSchema) })
  async clear(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("materialId") materialId: string,
  ) {
    const result = await this.ratings.clearRating({
      accountId: current.accountId,
      materialId,
    });
    if (!result.ok) throwRatingError(result.error);
    return { rating: result.value };
  }
}

function throwRatingError(error: RateLessonError): never {
  switch (error.code) {
    case "invalid_request":
      throw ratingException(400, error);
    case "access_denied":
      throw ratingException(403, error);
    case "material_not_found":
      throw ratingException(404, error);
    case "dependency_unavailable":
      throw ratingException(503, error);
    default:
      return assertNever(error);
  }
}

function ratingException(
  status: number,
  error: RateLessonError,
): HttpException {
  return problemException(status, error.code, "Lesson rating request failed");
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Lesson Rating error: ${JSON.stringify(value)}`);
}
