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
import { exerciseStatisticsSchema } from "../../domain/exercise-statistics.js";
import { ExerciseAttempts } from "../../facets/exercise-attempts/exercise-attempts.js";
import type { ReadExerciseStatisticsResult } from "../../features/read-exercise-statistics/read-exercise-statistics.js";

const statisticsListSchema = z
  .object({ exercises: z.array(exerciseStatisticsSchema) })
  .strict();

/** Author statistics of the exercises of one lesson (#2124). */
@AuthoringEndpoint()
@Controller("authoring/materials")
export class ExerciseStatisticsController {
  constructor(
    @Inject(ExerciseAttempts) private readonly attempts: ExerciseAttempts,
  ) {}

  @Get(":materialId/exercise-statistics")
  @ApiOperation({
    operationId: "readExerciseStatistics",
    summary:
      "Read first-try statistics of every answered exercise version of a Material. Requires materials:manage",
  })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(statisticsListSchema) })
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
  async read(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("materialId") materialId: string,
  ) {
    const result = await this.attempts.readStatistics({
      actor: current.accountId,
      materialId,
    });
    if (!result.ok) throwStatisticsError(result.error);
    return {
      exercises: result.value.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        kind: exercise.kind,
        versions: exercise.versions.map((version) => ({
          fingerprint: version.fingerprint,
          firstAnsweredAt: version.firstAnsweredAt,
          respondents: version.respondents,
          firstTryCorrect: version.firstTryCorrect,
          firstTryDontKnow: version.firstTryDontKnow,
          mostFrequentWrongAnswer:
            version.mostFrequentWrongAnswer === null
              ? null
              : {
                  answer: version.mostFrequentWrongAnswer.answer,
                  count: version.mostFrequentWrongAnswer.count,
                },
        })),
      })),
    };
  }
}

type StatisticsError = Extract<
  ReadExerciseStatisticsResult,
  { readonly ok: false }
>["error"];

function throwStatisticsError(error: StatisticsError): never {
  switch (error.code) {
    case "invalid_request":
      throw problemException(400, error.code, "Invalid statistics request");
    case "forbidden":
      throw problemException(403, error.code, "Statistics are forbidden");
    case "dependency_unavailable":
      throw problemException(503, error.code, "Statistics are unavailable");
    default:
      return assertNever(error);
  }
}

function assertNever(value: never): never {
  throw new Error(
    `Unexpected Exercise Statistics error: ${JSON.stringify(value)}`,
  );
}
