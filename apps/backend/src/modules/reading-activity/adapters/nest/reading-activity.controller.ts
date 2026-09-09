import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Put, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsOneOfContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { AccountGuard, AccountProblemDetailsFilter, CurrentAccount, accountProblemSchema, type AuthenticatedAccount } from "../../../accounts/index.js";
import { readingStateSchema, readingOutcomeSchema } from "../../domain/reading-state.js";
import { ReadingActivity } from "../../facets/reading-activity/reading-activity.js";
import { getReadingStatesSchema, type GetReadingStatesResult } from "../../features/get-reading-states/get-reading-states.js";
import { seriesProgressSchema, type GetSeriesProgressResult } from "../../features/get-series-progress/get-series-progress.js";
import { setReadingStateSchema, type SetReadingStateError } from "../../features/set-reading-state/set-reading-state.contract.js";

@ApiTags("Reading activity")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@ApiResponse({ status: 400, content: problemDetailsOneOfContent(problemDetailsSchema(400, ["invalid_request"]), accountProblemSchema) })
@ApiResponse({ status: 401, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 500, content: problemDetailsContent(accountProblemSchema) })
@ApiResponse({ status: 503, content: problemDetailsOneOfContent(problemDetailsSchema(503, ["dependency_unavailable"]), accountProblemSchema) })
@Controller("reading-activity")
export class ReadingActivityController {
  constructor(@Inject(ReadingActivity) private readonly reading: ReadingActivity) {}

  @Put("materials/:materialId")
  @HttpCode(200)
  @ApiOperation({ operationId: "setMaterialReadingState", summary: "Set the current Account's manual Material mark" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiBody({ schema: toOpenApiSchema(setReadingStateSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(readingOutcomeSchema.extend({ replayed: z.boolean() })) })
  @ApiResponse({ status: 403, content: problemDetailsContent(problemDetailsSchema(403, ["access_denied"])) })
  @ApiResponse({ status: 409, content: problemDetailsOneOfContent(
    problemDetailsSchema(409, ["command_conflict", "access_changed"]),
    problemDetailsSchema(409, ["stale_version"]).extend({ current: readingStateSchema }), accountProblemSchema,
  ) })
  async set(@CurrentAccount() current: AuthenticatedAccount, @Param("materialId") materialId: string, @Body() input: unknown) {
    const parsed = setReadingStateSchema.safeParse(input);
    if (!parsed.success) throw readingException(400, { code: "invalid_request" });
    const result = await this.reading.setReadingState({ ...parsed.data, materialId, accountId: current.accountId });
    if (!result.ok) throwReadingError(result.error);
    return result.value;
  }

  @Post("materials/query")
  @HttpCode(200)
  @ApiOperation({ operationId: "getMaterialReadingStates", summary: "Read personal states for at most 100 Material IDs" })
  @ApiBody({ schema: toOpenApiSchema(getReadingStatesSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(z.array(readingStateSchema)) })
  @ApiResponse({ status: 409, content: problemDetailsContent(accountProblemSchema) })
  async states(@CurrentAccount() current: AuthenticatedAccount, @Body() input: unknown) {
    const parsed = getReadingStatesSchema.safeParse(input);
    if (!parsed.success) throw readingException(400, { code: "invalid_request" });
    const result = await this.reading.getReadingStates({ ...parsed.data, accountId: current.accountId });
    if (!result.ok) throwReadingError(result.error);
    return result.value;
  }

  @Get("guides/:guideId")
  @ApiOperation({ operationId: "getGuideReadingProgress", summary: "Read progress over the current published Guide composition" })
  @ApiParam({ name: "guideId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(seriesProgressSchema) })
  @ApiResponse({ status: 404, content: problemDetailsContent(problemDetailsSchema(404, ["series_not_found"])) })
  @ApiResponse({ status: 409, content: problemDetailsContent(accountProblemSchema) })
  @ApiResponse({ status: 422, content: problemDetailsContent(problemDetailsSchema(422, ["series_too_large"])) })
  async guide(@CurrentAccount() current: AuthenticatedAccount, @Param("guideId") seriesId: string) {
    const result = await this.reading.getSeriesProgress({ seriesId, accountId: current.accountId });
    if (!result.ok) throwReadingError(result.error);
    return result.value;
  }

  @Get("series/:seriesId")
  @ApiOperation({ operationId: "getSeriesReadingProgress", deprecated: true, summary: "Read progress over the current published Series composition" })
  @ApiParam({ name: "seriesId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(seriesProgressSchema) })
  @ApiResponse({ status: 404, content: problemDetailsContent(problemDetailsSchema(404, ["series_not_found"])) })
  @ApiResponse({ status: 409, content: problemDetailsContent(accountProblemSchema) })
  @ApiResponse({ status: 422, content: problemDetailsContent(problemDetailsSchema(422, ["series_too_large"])) })
  async series(@CurrentAccount() current: AuthenticatedAccount, @Param("seriesId") seriesId: string) {
    const result = await this.reading.getSeriesProgress({ seriesId, accountId: current.accountId });
    if (!result.ok) throwReadingError(result.error);
    return result.value;
  }
}

type ReadingError = SetReadingStateError |
  Extract<GetReadingStatesResult | GetSeriesProgressResult, { readonly ok: false }>["error"];

function throwReadingError(error: ReadingError): never {
  switch (error.code) {
    case "invalid_request": throw readingException(400, error);
    case "access_denied": throw readingException(403, error);
    case "series_not_found": throw readingException(404, error);
    case "command_conflict":
    case "stale_version":
    case "access_changed": throw readingException(409, error);
    case "series_too_large": throw readingException(422, error);
    case "dependency_unavailable": throw readingException(503, error);
    default: return assertNever(error);
  }
}

function readingException(status: number, error: ReadingError): HttpException {
  return new HttpException({ type: "about:blank", title: "Reading activity request failed", status, ...error }, status);
}
function assertNever(value: never): never { throw new Error(`Unexpected ReadingActivity error: ${JSON.stringify(value)}`); }
