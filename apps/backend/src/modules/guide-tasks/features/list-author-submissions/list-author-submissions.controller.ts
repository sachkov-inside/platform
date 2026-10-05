import {
  Controller,
  Get,
  Inject,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
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
  authorFeedbackHttp,
  authorFeedbackHttpSchema,
} from "../../adapters/nest/author-feedback-http.js";
import {
  criterionHttp,
  criterionHttpSchema,
  learnerTaskFailureProblemSchema,
  learnerTaskUnavailableProblemSchema,
  throwSystemError,
} from "../../adapters/nest/learner-task-http.js";
import {
  SUBMISSION_REVIEW,
  type SubmissionReview,
} from "../../facets/submission-review/submission-review.js";
import {
  authorSubmissionsQuerySchema,
  submissionsCursorSchema,
  submissionsLimitSchema,
} from "./list-author-submissions.js";

const reportCriterionHttpSchema = z
  .object({
    criterionId: z.string(),
    status: z.enum(["confirmed", "violation", "not_verified"]),
    evidence: z.string(),
    gap: z.string(),
    obtainedByRun: z.boolean(),
  })
  .strict();

export const authorSubmissionsHttpSchema = z
  .object({
    guides: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string(),
          chapters: z.array(
            z
              .object({
                id: z.uuid(),
                name: z.string(),
                tasks: z.array(
                  z.object({ code: z.string(), title: z.string() }).strict(),
                ),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    submissions: z.array(
      z
        .object({
          submissionId: z.uuid(),
          submittedAt: z.iso.datetime(),
          source: z.enum(["mcp", "form"]),
          task: z
            .object({
              code: z.string(),
              title: z.string(),
              guideId: z.uuid(),
              guideName: z.string(),
              chapterId: z.uuid(),
              chapterName: z.string(),
              currentVersion: z.number().int().positive(),
            })
            .strict(),
          taskVersion: z.number().int().positive(),
          person: z
            .object({
              accountId: z.uuid(),
              telegramIdentityRef: z.string().nullable(),
            })
            .strict(),
          note: z.string(),
          reviewReport: z
            .object({ criteria: z.array(reportCriterionHttpSchema) })
            .strict()
            .nullable(),
          reportText: z.string().nullable(),
          serviceMark: z
            .object({
              repositoryUrl: z.string().nullable(),
              branch: z.string().nullable(),
              commit: z.string().nullable(),
              uncommittedChanges: z.boolean().nullable(),
            })
            .strict(),
          authorFeedback: authorFeedbackHttpSchema.nullable(),
        })
        .strict(),
    ),
    versions: z.array(
      z
        .object({
          code: z.string(),
          version: z.number().int().positive(),
          criteria: z.array(criterionHttpSchema),
        })
        .strict(),
    ),
    nextCursor: z.string().nullable(),
  })
  .strict();

const query = authorSubmissionsQuerySchema.shape;

@ApiTags("Guide task authoring")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("authoring/guide-tasks/submissions")
export class ListAuthorSubmissionsController {
  constructor(
    @Inject(SUBMISSION_REVIEW)
    private readonly review: Pick<SubmissionReview, "list">,
  ) {}

  @Get()
  @ApiOperation({
    operationId: "listAuthorTaskSubmissions",
    summary:
      "List Guide Task submissions for the author, newest first, by Guide, chapter and task, with the person, report, service mark, criteria of their versions and Author Feedback",
  })
  @ApiQuery({
    name: "guideId",
    required: false,
    schema: toOpenApiSchema(query.guideId),
  })
  @ApiQuery({
    name: "chapterId",
    required: false,
    schema: toOpenApiSchema(query.chapterId),
  })
  @ApiQuery({
    name: "taskCode",
    required: false,
    schema: toOpenApiSchema(query.taskCode),
  })
  @ApiQuery({
    name: "cursor",
    required: false,
    schema: toOpenApiSchema(submissionsCursorSchema),
  })
  @ApiQuery({
    name: "limit",
    required: false,
    schema: toOpenApiSchema(submissionsLimitSchema),
  })
  @ApiOkResponse({ schema: toOpenApiSchema(authorSubmissionsHttpSchema) })
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
    content: problemDetailsContent(problemDetailsSchema(403, ["forbidden"])),
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
    @Query() input: unknown,
  ): Promise<z.infer<typeof authorSubmissionsHttpSchema>> {
    const result = await this.review.list(account.accountId, input);
    if (!result.ok) {
      const error = result.error;
      switch (error.code) {
        case "invalid_request_shape":
          throw problemException(
            400,
            error.code,
            "Submissions query is malformed",
          );
        case "forbidden":
          throw problemException(
            403,
            error.code,
            "Reading submissions requires materials:manage",
          );
        case "dependency_unavailable":
        case "internal_error":
          throwSystemError(error, "Author submissions read");
      }
    }
    const value = result.value;
    return {
      guides: value.guides.map((guide) => ({
        id: guide.id,
        name: guide.name,
        chapters: guide.chapters.map((chapter) => ({
          id: chapter.id,
          name: chapter.name,
          tasks: chapter.tasks.map((task) => ({
            code: task.code,
            title: task.title,
          })),
        })),
      })),
      submissions: value.submissions.map((submission) => ({
        submissionId: submission.submissionId,
        submittedAt: submission.submittedAt,
        source: submission.source,
        task: {
          code: submission.task.code,
          title: submission.task.title,
          guideId: submission.task.guideId,
          guideName: submission.task.guideName,
          chapterId: submission.task.chapterId,
          chapterName: submission.task.chapterName,
          currentVersion: submission.task.currentVersion,
        },
        taskVersion: submission.taskVersion,
        person: {
          accountId: submission.person.accountId,
          telegramIdentityRef: submission.person.telegramIdentityRef,
        },
        note: submission.note,
        reviewReport:
          submission.reviewReport === null
            ? null
            : {
                criteria: submission.reviewReport.criteria.map((criterion) => ({
                  criterionId: criterion.criterionId,
                  status: criterion.status,
                  evidence: criterion.evidence,
                  gap: criterion.gap,
                  obtainedByRun: criterion.obtainedByRun,
                })),
              },
        reportText: submission.reportText,
        serviceMark: {
          repositoryUrl: submission.serviceMark.repositoryUrl,
          branch: submission.serviceMark.branch,
          commit: submission.serviceMark.commit,
          uncommittedChanges: submission.serviceMark.uncommittedChanges,
        },
        authorFeedback:
          submission.authorFeedback === null
            ? null
            : authorFeedbackHttp(submission.authorFeedback),
      })),
      versions: value.versions.map((version) => ({
        code: version.code,
        version: version.version,
        criteria: version.criteria.map(criterionHttp),
      })),
      nextCursor: value.nextCursor,
    };
  }
}
