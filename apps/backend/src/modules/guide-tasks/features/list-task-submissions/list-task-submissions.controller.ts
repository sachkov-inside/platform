import {
  Controller,
  Get,
  Inject,
  Param,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
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
  criterionHttpSchema,
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

export const ownTaskSubmissionsHttpSchema = z
  .object({
    code: z.string(),
    currentVersion: z.number().int().positive(),
    versions: z.array(
      z
        .object({
          version: z.number().int().positive(),
          criteria: z.array(criterionHttpSchema),
        })
        .strict(),
    ),
    submissions: z.array(
      z
        .object({
          submissionId: z.uuid(),
          taskVersion: z.number().int().positive(),
          source: z.enum(["mcp", "form"]),
          submittedAt: z.iso.datetime(),
          note: z.string(),
          reportText: z.string().nullable(),
          repositoryUrl: z.string().nullable(),
          authorFeedback: z
            .object({
              comment: z.string().nullable(),
              reviewedAt: z.iso.datetime().nullable(),
            })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
  })
  .strict();

@ApiTags("Guide tasks")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("accounts/current/guide-tasks")
export class ListOwnTaskSubmissionsController {
  constructor(
    @Inject(LEARNING_TASKS)
    private readonly tasks: Pick<LearningTasks, "submissions">,
  ) {}

  @Get(":code/submissions")
  @ApiOperation({
    operationId: "listOwnTaskSubmissions",
    summary:
      "List the current Account's submissions of a Guide Task with the criteria of their versions and author feedback",
  })
  @ApiParam({ name: "code", schema: toOpenApiSchema(taskCodeParamSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(ownTaskSubmissionsHttpSchema) })
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
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["task_not_available"]),
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
  async list(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("code") code: string,
  ): Promise<z.infer<typeof ownTaskSubmissionsHttpSchema>> {
    const result = await this.tasks.submissions({
      subject: learnerSubject(account),
      code,
    });
    if (!result.ok) {
      const error = result.error;
      switch (error.code) {
        case "invalid_request_shape":
          throw problemException(400, error.code, "Task code is malformed");
        case "task_not_available":
          throw problemException(404, error.code, "Task is not available");
        case "dependency_unavailable":
        case "internal_error":
          throwSystemError(error, "Task submissions read");
      }
    }
    const value = result.value;
    return {
      code: value.code,
      currentVersion: value.currentVersion,
      versions: value.versions.map((version) => ({
        version: version.version,
        criteria: version.criteria.map((criterion) => ({
          id: criterion.id,
          level: criterion.level,
          requirement: criterion.requirement,
          acceptableEvidence: [...criterion.acceptableEvidence],
        })),
      })),
      submissions: value.submissions.map((submission) => ({
        submissionId: submission.submissionId,
        taskVersion: submission.taskVersion,
        source: submission.source,
        submittedAt: submission.submittedAt,
        note: submission.note,
        reportText: submission.reportText,
        repositoryUrl: submission.serviceMark.repositoryUrl,
        authorFeedback:
          submission.authorFeedback === null
            ? null
            : {
                comment: submission.authorFeedback.comment,
                reviewedAt: submission.authorFeedback.reviewedAt,
              },
      })),
    };
  }
}
