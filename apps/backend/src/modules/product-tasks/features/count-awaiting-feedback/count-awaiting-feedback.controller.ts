import { Controller, Get, Inject, UseFilters, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
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
  learnerTaskFailureProblemSchema,
  learnerTaskUnavailableProblemSchema,
  throwSystemError,
} from "../../adapters/nest/learner-task-http.js";
import {
  SUBMISSION_REVIEW,
  type SubmissionReview,
} from "../../facets/submission-review/submission-review.js";

const awaitingFeedbackCountHttpSchema = z
  .object({ count: z.number().int().nonnegative() })
  .strict();

@ApiTags("Product task authoring")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("authoring/product-tasks/submissions")
export class CountSubmissionsAwaitingFeedbackController {
  constructor(
    @Inject(SUBMISSION_REVIEW)
    private readonly review: Pick<SubmissionReview, "countAwaitingFeedback">,
  ) {}

  @Get("awaiting-feedback-count")
  @ApiOperation({
    operationId: "countSubmissionsAwaitingFeedback",
    summary:
      "Count Product Task submissions awaiting Author Feedback: those without a stored comment or «посмотрел автор» mark, as the feedback=awaiting filter of the submissions list reads them",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(awaitingFeedbackCountHttpSchema) })
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
  async count(
    @CurrentAccount() account: AuthenticatedAccount,
  ): Promise<z.infer<typeof awaitingFeedbackCountHttpSchema>> {
    const result = await this.review.countAwaitingFeedback(account.accountId);
    if (!result.ok) {
      const error = result.error;
      switch (error.code) {
        case "forbidden":
          throw problemException(
            403,
            error.code,
            "Counting submissions requires materials:manage",
          );
        case "dependency_unavailable":
        case "internal_error":
          throwSystemError(error, "Submissions awaiting feedback count");
      }
    }
    return { count: result.value.count };
  }
}
