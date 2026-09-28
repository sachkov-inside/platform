import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  type HttpException,
  Inject,
  Post,
  Put,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
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
}

type CourseAssistantHttpError =
  | CompleteRepositoryConnectionError
  | Extract<
      | AcknowledgeDataNoticeResult
      | BeginRepositoryConnectionResult
      | LinkRepositoryResult,
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
    case "stale_data_notice":
    case "invalid_connection":
    case "repository_not_available":
      throw courseAssistantException(409, error.code);
    case "write_access_requested":
      throw courseAssistantException(422, error.code);
    case "dependency_unavailable":
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
