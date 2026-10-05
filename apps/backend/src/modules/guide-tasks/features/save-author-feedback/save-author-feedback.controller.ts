import {
  Body,
  Controller,
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
  accountProblemSchema,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import {
  authorFeedbackHttp,
  authorFeedbackHttpSchema,
} from "../../adapters/nest/author-feedback-http.js";
import {
  learnerTaskFailureProblemSchema,
  learnerTaskUnavailableProblemSchema,
  throwSystemError,
} from "../../adapters/nest/learner-task-http.js";
import {
  SUBMISSION_REVIEW,
  type SubmissionReview,
} from "../../facets/submission-review/submission-review.js";
import { authorFeedbackBodySchema } from "./save-author-feedback.js";

const savedFeedbackHttpSchema = z
  .object({ authorFeedback: authorFeedbackHttpSchema.nullable() })
  .strict();

@ApiTags("Guide task authoring")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("authoring/guide-tasks/submissions")
export class SaveAuthorFeedbackController {
  constructor(
    @Inject(SUBMISSION_REVIEW)
    private readonly review: Pick<SubmissionReview, "saveFeedback">,
  ) {}

  @Put(":submissionId/feedback")
  @ApiOperation({
    operationId: "saveAuthorTaskFeedback",
    summary:
      "Write or change the author's comment and «reviewed» mark on a Guide Task submission; an empty comment without the mark removes the feedback",
  })
  @ApiParam({ name: "submissionId", schema: toOpenApiSchema(z.uuid()) })
  @ApiBody({ schema: toOpenApiSchema(authorFeedbackBodySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(savedFeedbackHttpSchema) })
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
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, ["submission_not_found"]),
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
  async save(
    @CurrentAccount() account: AuthenticatedAccount,
    @Param("submissionId") submissionId: string,
    @Body() body: unknown,
  ): Promise<z.infer<typeof savedFeedbackHttpSchema>> {
    const parsed = authorFeedbackBodySchema.safeParse(body);
    if (!parsed.success)
      throw problemException(
        400,
        "invalid_request_shape",
        "Author feedback is malformed",
      );
    const result = await this.review.saveFeedback(account.accountId, {
      submissionId,
      comment: parsed.data.comment,
      reviewed: parsed.data.reviewed,
    });
    if (!result.ok) {
      const error = result.error;
      switch (error.code) {
        case "invalid_request_shape":
          throw problemException(
            400,
            error.code,
            "Author feedback is malformed",
          );
        case "forbidden":
          throw problemException(
            403,
            error.code,
            "Author feedback requires materials:manage",
          );
        case "submission_not_found":
          throw problemException(404, error.code, "Submission not found");
        case "dependency_unavailable":
        case "internal_error":
          throwSystemError(error, "Author feedback save");
      }
    }
    return {
      authorFeedback:
        result.value === null ? null : authorFeedbackHttp(result.value),
    };
  }
}
