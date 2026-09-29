import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  type HttpException,
  Inject,
  Param,
  Post,
  Put,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
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
import { repositoryLinkViewSchema } from "../../domain/repository-link.js";
import { CourseAssistant } from "../../facets/course-assistant/course-assistant.js";
import {
  acknowledgeDataNoticeSchema,
  dataNoticeAcknowledgementSchema,
} from "../../features/acknowledge-data-notice/acknowledge-data-notice.js";
import { repositoryConnectionSchema } from "../../features/begin-repository-connection/begin-repository-connection.js";
import {
  completeRepositoryConnectionSchema,
  repositoryConnectionOutcomeSchema,
  type CompleteRepositoryConnectionError,
} from "../../features/complete-repository-connection/complete-repository-connection.js";
import { repositoryDisconnectionSchema } from "../../features/disconnect-repository/disconnect-repository.js";
import {
  linkRepositorySchema,
  type LinkRepositoryResult,
} from "../../features/link-repository/link-repository.js";
import { linkableRepositoriesSchema } from "../../features/list-linkable-repositories/list-linkable-repositories.js";
import { repositoryLinkHistorySchema } from "../../features/list-repository-links/list-repository-links.js";
import { participantStateSchema } from "../../features/read-participant-state/read-participant-state.js";
import {
  chooseReviewCandidateSchema,
  type ChooseReviewCandidateResult,
} from "../../features/choose-review-candidate/choose-review-candidate.js";
import {
  practiceConversationSchema,
  type ReadPracticeConversationResult,
} from "../../features/read-practice-conversation/read-practice-conversation.js";
import type { ReadPracticeReviewResult } from "../../features/read-practice-review/read-practice-review.js";
import {
  requestPracticeReviewSchema,
  type RequestPracticeReviewResult,
} from "../../features/request-practice-review/request-practice-review.js";
import { practiceIdSchema } from "../../shared/practice-reviews.js";
import {
  practiceReviewViewSchema,
  type PracticeReviewView,
} from "../../shared/practice-review-view.js";
import type { AcknowledgeDataNoticeResult } from "../../features/acknowledge-data-notice/acknowledge-data-notice.js";
import type { BeginRepositoryConnectionResult } from "../../features/begin-repository-connection/begin-repository-connection.js";

@ApiTags("Course assistant")
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
  status: 404,
  content: problemDetailsContent(
    problemDetailsSchema(404, ["course_assistant_unavailable"]),
  ),
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
@Controller("course-assistant")
export class CourseAssistantController {
  constructor(
    @Inject(CourseAssistant) private readonly assistant: CourseAssistant,
  ) {}

  @Get("participant")
  @ApiOperation({
    operationId: "readCourseAssistantParticipant",
    summary:
      "Read the data notice and Repository Link of the current Account's course assistant",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(participantStateSchema) })
  async participant(@CurrentAccount() current: AuthenticatedAccount) {
    const result = await this.assistant.readParticipantState(current);
    if (!result.ok) throwCourseAssistantError(result.error);
    return {
      dataNotice: result.value.dataNotice,
      repositoryLink: result.value.repositoryLink,
    };
  }

  @Post("data-notice/acknowledgement")
  @HttpCode(200)
  @ApiOperation({
    operationId: "acknowledgeCourseAssistantDataNotice",
    summary: "Record that the current Account read the data notice version",
  })
  @ApiBody({ schema: toOpenApiSchema(acknowledgeDataNoticeSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(dataNoticeAcknowledgementSchema) })
  @ApiResponse({
    status: 409,
    content: problemDetailsContent(
      problemDetailsSchema(409, ["stale_data_notice"]),
    ),
  })
  async acknowledge(
    @CurrentAccount() current: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const parsed = acknowledgeDataNoticeSchema.safeParse(input);
    if (!parsed.success) throwCourseAssistantError({ code: "invalid_request" });
    const result = await this.assistant.acknowledgeDataNotice({
      accountId: current.accountId,
      noticeVersion: parsed.data.noticeVersion,
    });
    if (!result.ok) throwCourseAssistantError(result.error);
    return {
      version: result.value.version,
      acknowledgedAt: result.value.acknowledgedAt,
    };
  }

  @Post("repository-connections")
  @HttpCode(200)
  @ApiOperation({
    operationId: "beginCourseAssistantRepositoryConnection",
    summary: "Start installing the course GitHub App for the current Account",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(repositoryConnectionSchema) })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(
      problemDetailsSchema(403, ["data_notice_required"]),
    ),
  })
  async begin(@CurrentAccount() current: AuthenticatedAccount) {
    const result = await this.assistant.beginRepositoryConnection(current);
    if (!result.ok) throwCourseAssistantError(result.error);
    return { installUrl: result.value.installUrl };
  }

  @Post("repository-connections/completion")
  @HttpCode(200)
  @ApiOperation({
    operationId: "completeCourseAssistantRepositoryConnection",
    summary:
      "Verify the GitHub App installation returned from GitHub and link its only repository",
  })
  @ApiBody({ schema: toOpenApiSchema(completeRepositoryConnectionSchema) })
  @ApiOkResponse({
    schema: toOpenApiSchema(repositoryConnectionOutcomeSchema),
  })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(
      problemDetailsSchema(403, [
        "data_notice_required",
        "installation_not_owned",
      ]),
    ),
  })
  @ApiResponse({
    status: 409,
    content: problemDetailsContent(
      problemDetailsSchema(409, ["invalid_connection"]),
    ),
  })
  @ApiResponse({
    status: 422,
    content: problemDetailsContent(
      problemDetailsSchema(422, ["write_access_requested"]),
    ),
  })
  async complete(
    @CurrentAccount() current: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const parsed = completeRepositoryConnectionSchema.safeParse(input);
    if (!parsed.success) throwCourseAssistantError({ code: "invalid_request" });
    const result = await this.assistant.completeRepositoryConnection({
      accountId: current.accountId,
      state: parsed.data.state,
      code: parsed.data.code,
      installationId: parsed.data.installationId,
    });
    if (!result.ok) throwCourseAssistantError(result.error);
    return {
      repositoryLink: result.value.repositoryLink,
      repositories: result.value.repositories,
    };
  }

  @Get("repositories")
  @ApiOperation({
    operationId: "listCourseAssistantRepositories",
    summary:
      "List repositories the current Account's verified installations open",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(linkableRepositoriesSchema) })
  async repositories(@CurrentAccount() current: AuthenticatedAccount) {
    const result = await this.assistant.listLinkableRepositories(current);
    if (!result.ok) throwCourseAssistantError(result.error);
    return { repositories: result.value.repositories };
  }

  @Put("repository-link")
  @HttpCode(200)
  @ApiOperation({
    operationId: "linkCourseAssistantRepository",
    summary: "Choose or change the current Account's Repository Link",
  })
  @ApiBody({ schema: toOpenApiSchema(linkRepositorySchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(repositoryLinkViewSchema) })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(
      problemDetailsSchema(403, ["data_notice_required"]),
    ),
  })
  @ApiResponse({
    status: 409,
    content: problemDetailsContent(
      problemDetailsSchema(409, ["repository_not_available"]),
    ),
  })
  async link(
    @CurrentAccount() current: AuthenticatedAccount,
    @Body() input: unknown,
  ) {
    const parsed = linkRepositorySchema.safeParse(input);
    if (!parsed.success) throwCourseAssistantError({ code: "invalid_request" });
    const result = await this.assistant.linkRepository({
      accountId: current.accountId,
      installationId: parsed.data.installationId,
      repositoryId: parsed.data.repositoryId,
    });
    if (!result.ok) throwCourseAssistantError(result.error);
    return {
      installationId: result.value.installationId,
      repository: result.value.repository,
      connectedAt: result.value.connectedAt,
      access: result.value.access,
    };
  }

  @Delete("repository-link")
  @HttpCode(200)
  @ApiOperation({
    operationId: "disconnectCourseAssistantRepository",
    summary:
      "Disconnect the current Account's Repository Link, keeping history",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(repositoryDisconnectionSchema) })
  async disconnect(@CurrentAccount() current: AuthenticatedAccount) {
    const result = await this.assistant.disconnectRepository(current);
    if (!result.ok) throwCourseAssistantError(result.error);
    return { disconnected: result.value.disconnected };
  }

  @Get("author/repository-links")
  @ApiOperation({
    operationId: "listCourseAssistantRepositoryLinks",
    summary: "List every participant's Repository Link history for the author",
  })
  @ApiOkResponse({ schema: toOpenApiSchema(repositoryLinkHistorySchema) })
  async history(@CurrentAccount() current: AuthenticatedAccount) {
    const result = await this.assistant.listRepositoryLinks(current);
    if (!result.ok) throwCourseAssistantError(result.error);
    return { links: result.value.links };
  }

  @Get("practices/:practiceId/conversation")
  @ApiOperation({
    operationId: "readCourseAssistantPracticeConversation",
    summary:
      "Read the Assistant Conversation of a practice with its reviews and Practice Status",
  })
  @ApiParam({ name: "practiceId", schema: toOpenApiSchema(practiceIdSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(practiceConversationSchema) })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, [
        "course_assistant_unavailable",
        "practice_unavailable",
      ]),
    ),
  })
  async conversation(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("practiceId") practiceId: string,
  ) {
    const result = await this.assistant.readPracticeConversation({
      accountId: current.accountId,
      practiceId,
    });
    if (!result.ok) throwCourseAssistantError(result.error);
    return {
      practice: result.value.practice,
      status: result.value.status,
      activeReview: result.value.activeReview,
      messages: result.value.messages,
    };
  }

  @Post("practices/:practiceId/reviews")
  @HttpCode(202)
  @ApiOperation({
    operationId: "requestCourseAssistantPracticeReview",
    summary:
      "Queue a Practice Review of the current Account's linked repository, or return the running one",
  })
  @ApiParam({ name: "practiceId", schema: toOpenApiSchema(practiceIdSchema) })
  @ApiBody({ schema: toOpenApiSchema(requestPracticeReviewSchema) })
  @ApiAcceptedResponse({ schema: toOpenApiSchema(practiceReviewViewSchema) })
  @ApiResponse({
    status: 403,
    content: problemDetailsContent(
      problemDetailsSchema(403, ["data_notice_required"]),
    ),
  })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, [
        "course_assistant_unavailable",
        "practice_unavailable",
      ]),
    ),
  })
  @ApiResponse({
    status: 409,
    content: problemDetailsContent(
      problemDetailsSchema(409, [
        "repository_link_required",
        "repository_access_revoked",
        "practice_context_version_mismatch",
      ]).extend({ currentContextVersion: z.hash("sha256").optional() }),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      problemDetailsSchema(503, [
        "dependency_unavailable",
        "review_unavailable",
      ]),
    ),
  })
  async request(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("practiceId") practiceId: string,
    @Body() input: unknown,
  ) {
    const parsed = requestPracticeReviewSchema.safeParse(input);
    if (!parsed.success) throwCourseAssistantError({ code: "invalid_request" });
    const result = await this.assistant.requestPracticeReview({
      accountId: current.accountId,
      practiceId,
      expectedContextVersion: parsed.data.expectedContextVersion,
      candidate: parsed.data.candidate,
      chooseWork: parsed.data.chooseWork,
    });
    if (!result.ok) throwCourseAssistantError(result.error);
    return reviewBody(result.value);
  }

  @Get("reviews/:reviewId")
  @ApiOperation({
    operationId: "readCourseAssistantPracticeReview",
    summary: "Read one Practice Review of the current Account",
  })
  @ApiParam({ name: "reviewId", schema: { type: "string", format: "uuid" } })
  @ApiOkResponse({ schema: toOpenApiSchema(practiceReviewViewSchema) })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, [
        "course_assistant_unavailable",
        "review_not_found",
      ]),
    ),
  })
  async review(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("reviewId") reviewId: string,
  ) {
    const result = await this.assistant.readPracticeReview({
      accountId: current.accountId,
      reviewId,
    });
    if (!result.ok) throwCourseAssistantError(result.error);
    return reviewBody(result.value);
  }

  @Post("reviews/:reviewId/candidate")
  @HttpCode(202)
  @ApiOperation({
    operationId: "chooseCourseAssistantReviewCandidate",
    summary:
      "Choose which branch or pull request a waiting Practice Review checks",
  })
  @ApiParam({ name: "reviewId", schema: { type: "string", format: "uuid" } })
  @ApiBody({ schema: toOpenApiSchema(chooseReviewCandidateSchema) })
  @ApiAcceptedResponse({ schema: toOpenApiSchema(practiceReviewViewSchema) })
  @ApiResponse({
    status: 404,
    content: problemDetailsContent(
      problemDetailsSchema(404, [
        "course_assistant_unavailable",
        "review_not_found",
      ]),
    ),
  })
  @ApiResponse({
    status: 409,
    content: problemDetailsContent(
      problemDetailsSchema(409, [
        "review_not_awaiting_choice",
        "candidate_not_available",
      ]),
    ),
  })
  @ApiResponse({
    status: 503,
    content: problemDetailsContent(
      problemDetailsSchema(503, [
        "dependency_unavailable",
        "review_unavailable",
      ]),
    ),
  })
  async choose(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("reviewId") reviewId: string,
    @Body() input: unknown,
  ) {
    const parsed = chooseReviewCandidateSchema.safeParse(input);
    if (!parsed.success) throwCourseAssistantError({ code: "invalid_request" });
    const result = await this.assistant.chooseReviewCandidate({
      accountId: current.accountId,
      reviewId,
      candidateId: parsed.data.candidateId,
    });
    if (!result.ok) throwCourseAssistantError(result.error);
    return reviewBody(result.value);
  }
}

function reviewBody(review: PracticeReviewView) {
  return {
    id: review.id,
    practiceId: review.practiceId,
    kind: review.kind,
    state: review.state,
    contextVersion: review.contextVersion,
    repository: review.repository,
    requestedAt: review.requestedAt,
    completedAt: review.completedAt,
    candidates: review.candidates,
    checked: review.checked,
    result: review.result,
    previousReviewId: review.previousReviewId,
    failure: review.failure,
  };
}

type CourseAssistantHttpError =
  | CompleteRepositoryConnectionError
  | Extract<
      | AcknowledgeDataNoticeResult
      | BeginRepositoryConnectionResult
      | LinkRepositoryResult
      | RequestPracticeReviewResult
      | ChooseReviewCandidateResult
      | ReadPracticeConversationResult
      | ReadPracticeReviewResult,
      { readonly ok: false }
    >["error"];

function throwCourseAssistantError(error: CourseAssistantHttpError): never {
  switch (error.code) {
    case "invalid_request":
      throw courseAssistantException(400, error.code);
    case "unavailable":
      throw courseAssistantException(404, "course_assistant_unavailable");
    case "data_notice_required":
    case "installation_not_owned":
      throw courseAssistantException(403, error.code);
    case "practice_unavailable":
    case "review_not_found":
      throw courseAssistantException(404, error.code);
    case "stale_data_notice":
    case "invalid_connection":
    case "repository_not_available":
    case "repository_link_required":
    case "repository_access_revoked":
    case "review_not_awaiting_choice":
    case "candidate_not_available":
      throw courseAssistantException(409, error.code);
    case "practice_context_version_mismatch":
      throw problemException(
        409,
        error.code,
        "Course assistant request failed",
        {
          currentContextVersion: error.currentContextVersion,
        },
      );
    case "write_access_requested":
      throw courseAssistantException(422, error.code);
    case "dependency_unavailable":
    case "review_unavailable":
      throw courseAssistantException(503, error.code);
    default:
      return assertNever(error);
  }
}

function courseAssistantException(status: number, code: string): HttpException {
  return problemException(status, code, "Course assistant request failed");
}
function assertNever(value: never): never {
  throw new Error(
    `Unexpected course assistant error: ${JSON.stringify(value)}`,
  );
}
