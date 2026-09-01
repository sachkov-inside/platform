import { randomUUID } from "node:crypto";

import { Body, Controller, HttpCode, HttpException, Inject, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  CurrentAccount,
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  accountId,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { anonymousSubject } from "../../../content-access/index.js";
import { VIDEO_PLAYBACK, type VideoPlayback } from "../../facets/video-playback/video-playback.js";

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
const playbackProblemSchema = z.object({
  code: z.enum(["access_denied", "dependency_unavailable", "invalid_request", "video_mismatch", "video_not_ready"]),
  status: z.number().int(),
  title: z.string(),
  type: z.string(),
}).loose();

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
  @ApiResponse({ status: 403, content: problemDetailsContent(playbackProblemSchema) })
  @ApiResponse({ status: 409, content: problemDetailsContent(playbackProblemSchema) })
  @ApiResponse({ status: 503, content: problemDetailsContent(playbackProblemSchema) })
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
    if (!result.ok) {
      const status = result.error.code === "dependency_unavailable" ? 503 : result.error.code === "video_not_ready" ? 409 : 403;
      throw new HttpException({ code: result.error.code, status }, status);
    }
    return result.value;
  }
}

@ApiTags("Video playback")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
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
  @ApiResponse({ status: 400, content: problemDetailsContent(playbackProblemSchema) })
  @ApiResponse({ status: 403, content: problemDetailsContent(playbackProblemSchema) })
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
    if (!saved) throw new HttpException({ code: "access_denied", status: 403 }, 403);
  }
}
