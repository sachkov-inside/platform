import {
  Body,
  Controller,
  Get,
  HttpCode,
  type HttpException,
  Inject,
  Param,
  Post,
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
import {
  exerciseAnswerSchema,
  exerciseIdSchema,
} from "@inside/material-blocks";
import { z } from "zod";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
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
import { exerciseAttemptSchema } from "../../domain/exercise-attempt.js";
import { ExerciseAttempts } from "../../facets/exercise-attempts/exercise-attempts.js";
import type { ReadExerciseAttemptsResult } from "../../features/read-exercise-attempts/read-exercise-attempts.js";
import type { RecordExerciseAttemptError } from "../../features/record-exercise-attempt/record-exercise-attempt.contract.js";

/** The request names the answer only: result, version and Account belong to the server. */
const recordBodySchema = z.object({ answer: exerciseAnswerSchema }).strict();
const attemptListSchema = z
  .object({ items: z.array(exerciseAttemptSchema) })
  .strict();

@ApiTags("Exercise Attempts")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
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
@Controller("exercise-attempts")
export class ExerciseAttemptsController {
  constructor(
    @Inject(ExerciseAttempts) private readonly attempts: ExerciseAttempts,
  ) {}

  @Post("materials/:materialId/exercises/:exerciseId")
  @HttpCode(200)
  @ApiOperation({
    operationId: "recordExerciseAttempt",
    summary:
      "Check the current Account's answer to a Lesson Exercise and record the attempt",
  })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiParam({ name: "exerciseId", schema: toOpenApiSchema(exerciseIdSchema) })
  @ApiBody({ schema: toOpenApiSchema(recordBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(exerciseAttemptSchema) })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(
      problemDetailsSchema(403, ["access_denied"]),
    ),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["exercise_not_found"]),
    ),
  })
  @ApiResponse({
    status: 422,
    content: problemDetailsContent(
      problemDetailsSchema(422, ["answer_mismatch"]),
    ),
  })
  async record(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("materialId") materialId: string,
    @Param("exerciseId") exerciseId: string,
    @Body() input: unknown,
  ) {
    const parsed = recordBodySchema.safeParse(input);
    if (!parsed.success) throwAttemptError({ code: "invalid_request" });
    const result = await this.attempts.recordAttempt({
      accountId: current.accountId,
      materialId,
      exerciseId,
      answer: parsed.data.answer,
    });
    if (!result.ok) throwAttemptError(result.error);
    return {
      exerciseId: result.value.exerciseId,
      fingerprint: result.value.fingerprint,
      answer: result.value.answer,
      result: result.value.result,
      firstForVersion: result.value.firstForVersion,
      attemptedAt: result.value.attemptedAt,
    };
  }

  @Get("materials/:materialId")
  @ApiOperation({
    operationId: "readExerciseAttempts",
    summary:
      "Read the current Account's latest attempt on each exercise of a Material",
  })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(attemptListSchema) })
  async read(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("materialId") materialId: string,
  ) {
    const result = await this.attempts.readAttempts({
      accountId: current.accountId,
      materialId,
    });
    if (!result.ok) throwAttemptError(result.error);
    return {
      items: result.value.map((attempt) => ({
        exerciseId: attempt.exerciseId,
        fingerprint: attempt.fingerprint,
        answer: attempt.answer,
        result: attempt.result,
        firstForVersion: attempt.firstForVersion,
        attemptedAt: attempt.attemptedAt,
      })),
    };
  }
}

type AttemptError =
  | RecordExerciseAttemptError
  | Extract<ReadExerciseAttemptsResult, { readonly ok: false }>["error"];

function throwAttemptError(error: AttemptError): never {
  switch (error.code) {
    case "invalid_request":
      throw attemptException(400, error);
    case "access_denied":
      throw attemptException(403, error);
    case "exercise_not_found":
      throw attemptException(404, error);
    case "answer_mismatch":
      throw attemptException(422, error);
    case "dependency_unavailable":
      throw attemptException(503, error);
    default:
      return assertNever(error);
  }
}

function attemptException(status: number, error: AttemptError): HttpException {
  return problemException(
    status,
    error.code,
    "Exercise attempt request failed",
  );
}
function assertNever(value: never): never {
  throw new Error(
    `Unexpected Exercise Attempt error: ${JSON.stringify(value)}`,
  );
}
