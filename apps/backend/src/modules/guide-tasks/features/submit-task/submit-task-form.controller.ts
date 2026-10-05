import {
  Body,
  Controller,
  HttpCode,
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
  accountProblemSchema,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  learnerSubject,
  learnerTaskFailureProblemSchema,
  learnerTaskUnavailableProblemSchema,
  taskCodeParamSchema,
  throwSystemError,
} from "../../adapters/nest/learner-task-http.js";
import {
  LEARNING_TASKS,
  type LearningTasks,
} from "../../facets/learning-tasks/learning-tasks.js";
import { formSubmissionSchema } from "./submit-task.js";

/** The page form body; the task code comes from the address. */
export const formSubmissionBodySchema = formSubmissionSchema.omit({
  code: true,
});

export const taskSubmissionReceiptHttpSchema = z
  .object({
    submissionId: z.uuid(),
    code: z.string(),
    taskVersion: z.number().int().positive(),
    source: z.enum(["mcp", "form"]),
    submittedAt: z.iso.datetime(),
  })
  .strict();

@ApiTags("Guide tasks")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("accounts/current/guide-tasks")
export class SubmitTaskFormController {
  constructor(
    @Inject(LEARNING_TASKS)
    private readonly tasks: Pick<LearningTasks, "submit">,
  ) {}

  @Post(":code/submissions")
  @HttpCode(200)
  @ApiOperation({
    operationId: "submitGuideTaskForm",
    summary:
      "Submit a Guide Task through the page form against the version the page showed",
  })
  @ApiParam({ name: "code", schema: toOpenApiSchema(taskCodeParamSchema) })
  @ApiBody({ schema: toOpenApiSchema(formSubmissionBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(taskSubmissionReceiptHttpSchema) })
  @ApiResponse({
    status: 400,
    content: problemDetailsContent(
      problemDetailsSchema(400, ["invalid_request_shape"]),
    ),
  })
  @ApiResponse({
    status: 401,
    content: problemDetailsContent(accountProblemSchema),
  })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(
      problemDetailsSchema(403, ["submissions_disabled"]),
    ),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["task_not_available"]),
    ),
  })
  @ApiResponse({
    status: 409,
    content: problemDetailsContent(
      problemDetailsSchema(409, [
        "task_version_changed",
        "idempotency_conflict",
      ]),
    ),
  })
  @ApiResponse({
    status: 429,
    content: problemDetailsContent(
      problemDetailsSchema(429, ["submission_rate_limited"]),
    ),
  })
  @ApiResponse({
    status: 500,
    content: problemDetailsOneOfContent(
      learnerTaskFailureProblemSchema,
      accountProblemSchema,
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsOneOfContent(
      learnerTaskUnavailableProblemSchema,
      accountProblemSchema,
    ),
  })
  async submit(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("code") code: string,
    @Body() input: unknown,
  ): Promise<z.infer<typeof taskSubmissionReceiptHttpSchema>> {
    const body = formSubmissionBodySchema.safeParse(input);
    if (!body.success)
      throw problemException(
        400,
        "invalid_request_shape",
        "Task submission is malformed",
      );
    const result = await this.tasks.submit({
      subject: learnerSubject(account),
      source: "form",
      submission: { ...body.data, code },
    });
    if (!result.ok) {
      const error = result.error;
      switch (error.code) {
        case "invalid_request_shape":
        case "report_coverage_mismatch":
          throw problemException(
            400,
            "invalid_request_shape",
            "Task submission is malformed",
          );
        case "submissions_disabled":
          throw problemException(
            403,
            error.code,
            "Task submissions are not accepted yet",
          );
        case "task_not_available":
          throw problemException(404, error.code, "Task is not available");
        case "task_version_changed":
          throw problemException(
            409,
            error.code,
            "Task requirements changed since the page was read",
            {
              submittedVersion: error.submittedVersion,
              currentVersion: error.currentVersion,
            },
          );
        case "idempotency_conflict":
          throw problemException(
            409,
            error.code,
            "Submission key was used for different content",
          );
        case "submission_rate_limited":
          throw problemException(
            429,
            error.code,
            "Too many submissions in the last hour",
          );
        case "dependency_unavailable":
        case "internal_error":
          throwSystemError(error, "Task submission");
      }
    }
    const receipt = result.value;
    return {
      submissionId: receipt.submissionId,
      code: receipt.code,
      taskVersion: receipt.taskVersion,
      source: receipt.source,
      submittedAt: receipt.submittedAt,
    };
  }
}
