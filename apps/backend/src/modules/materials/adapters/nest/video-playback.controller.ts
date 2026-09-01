import { randomUUID } from "node:crypto";

import { Body, Controller, HttpCode, HttpException, Inject, Param, Post, Put, UseFilters, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  problemDetailsOneOfContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  AccountProblemDetailsFilter,
  CurrentAccount,
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  accountProblemSchema,
  accountId,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { anonymousSubject } from "../../../content-access/index.js";
import {
  VIDEO_PLAYBACK,
  type PlaybackSessionResult,
  type VideoPlayback,
} from "../../facets/video-playback/video-playback.js";

const playbackSchema = z.object({
  drmAuthToken: z.string().nullable(),
  embedLocator: z.url(),
  progressScope: z.enum(["account", "anonymous"]),
  resumeSeconds: z.number().int().nonnegative().nullable(),
  videoId: z.uuid(),
}).strict();
const progressSchema = z.object({
  durationSeconds: z.number().int().positive(),
  positionSeconds: z.number().int().nonnegative(),
}).strict();
type PlaybackError = Extract<PlaybackSessionResult, { readonly ok: false }>["error"];

@ApiTags("Video playback")
@PrivateNoStore()
@OptionalAccountEndpoint()
@Controller("materials")
export class VideoPlaybackController {
  constructor(@Inject(VIDEO_PLAYBACK) private readonly playback: VideoPlayback) {}

  @Post(":materialId/videos/:videoId/playback")
  @HttpCode(200)
  @ApiOperation({ operationId: "createVideoPlaybackSession", summary: "Authorize and create a short-lived Video playback session" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiParam({ name: "videoId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(playbackSchema) })
  @ApiResponse({ status: 400, content: problemDetailsOneOfContent(playbackProblemSchema(400, ["invalid_request"]), accountProblemSchema) })
  @ApiResponse({ status: 403, content: problemDetailsContent(playbackProblemSchema(403, ["access_denied", "video_mismatch"])) })
  @ApiResponse({ status: 409, content: problemDetailsOneOfContent(playbackProblemSchema(409, ["video_not_ready"]), accountProblemSchema) })
  @ApiResponse({ status: 503, content: problemDetailsOneOfContent(playbackProblemSchema(503, ["dependency_unavailable"]), accountProblemSchema) })
  async create(
    @OptionalCurrentAccount() current: AuthenticatedAccount | undefined,
    @Param("materialId") materialId: string,
    @Param("videoId") videoId: string,
  ) {
    const result = await this.playback.createSession({
      correlationId: randomUUID(),
      materialId,
      subject: current === undefined
        ? anonymousSubject
        : { kind: "account", accountId: accountId(current.accountId) },
      videoId,
    });
    if (!result.ok) throwPlaybackError(result.error);
    return result.value;
  }
}

@ApiTags("Video playback")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("materials")
export class VideoProgressController {
  constructor(@Inject(VIDEO_PLAYBACK) private readonly playback: VideoPlayback) {}

  @Put(":materialId/videos/:videoId/progress")
  @HttpCode(204)
  @ApiOperation({ operationId: "saveVideoPlaybackProgress", summary: "Save coarse Account progress for one Video" })
  @ApiNoContentResponse()
  @ApiBody({ schema: toOpenApiSchema(progressSchema) })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiParam({ name: "videoId", schema: toOpenApiSchema(z.uuid()) })
  @ApiResponse({ status: 400, content: problemDetailsOneOfContent(playbackProblemSchema(400, ["invalid_request"]), accountProblemSchema) })
  @ApiResponse({ status: 401, content: problemDetailsContent(accountProblemSchema) })
  @ApiResponse({ status: 403, content: problemDetailsContent(playbackProblemSchema(403, ["access_denied", "video_mismatch"])) })
  @ApiResponse({ status: 409, content: problemDetailsOneOfContent(playbackProblemSchema(409, ["video_not_ready"]), accountProblemSchema) })
  @ApiResponse({ status: 500, content: problemDetailsContent(accountProblemSchema) })
  @ApiResponse({ status: 503, content: problemDetailsOneOfContent(playbackProblemSchema(503, ["dependency_unavailable"]), accountProblemSchema) })
  async save(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("materialId") materialId: string,
    @Param("videoId") videoId: string,
    @Body() input: unknown,
  ): Promise<void> {
    const parsed = progressSchema.safeParse(input);
    if (!parsed.success) throw new HttpException({ code: "invalid_request", status: 400 }, 400);
    const saved = await this.playback.saveProgress({
      accountId: current.accountId,
      materialId,
      videoId,
      ...parsed.data,
    });
    if (!saved.ok) throwPlaybackError(saved.error);
  }
}

function playbackProblemSchema(
  status: number,
  codes: readonly [PlaybackError["code"], ...PlaybackError["code"][]],
) {
  return z.object({
    code: z.enum(codes),
    status: z.literal(status),
    title: z.string(),
    type: z.string(),
  }).loose();
}

function throwPlaybackError(error: PlaybackError): never {
  switch (error.code) {
    case "invalid_request": throw playbackException(400, error.code);
    case "access_denied":
    case "video_mismatch": throw playbackException(403, error.code);
    case "video_not_ready": throw playbackException(409, error.code);
    case "dependency_unavailable": throw playbackException(503, error.code);
    default: return assertNever(error);
  }
}

function playbackException(status: number, code: PlaybackError["code"]): HttpException {
  return new HttpException({ code, status }, status);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Video playback error: ${JSON.stringify(value)}`);
}
