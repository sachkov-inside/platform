import { randomUUID, timingSafeEqual } from "node:crypto";

import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiHeader, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import { PLATFORM_CONFIG, type PlatformConfig } from "../../../../config/platform-config.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  CurrentAccount,
  OptionalAccountEndpoint,
  OptionalCurrentAccount,
  accountId,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { anonymousSubject } from "../../../content-access/index.js";
import { VIDEOS, type VideoError, type Videos } from "../../../videos/index.js";
import { MaterialAuthoringEndpoint } from "../../adapters/nest/material-authoring-endpoint.js";
import { VIDEO_PLAYBACK, type VideoPlaybackService } from "./video-playback.js";

const videoSchema = z.object({
  access: z.enum(["free", "membership"]),
  failureCode: z.string().optional(),
  materialId: z.uuid(),
  state: z.enum(["uploading", "processing", "ready", "failed"]),
  title: z.string(),
  videoId: z.uuid(),
}).strict();
const initBodySchema = z.object({
  access: z.enum(["free", "membership"]),
  byteSize: z.number().int().positive(),
  filename: z.string().min(1).max(255),
  title: z.string().min(1).max(255),
}).strict();
const initResponseSchema = z.object({ uploadEndpoint: z.url(), video: videoSchema }).strict();
const attachBodySchema = z.object({
  access: z.enum(["free", "membership"]),
  providerVideoId: z.string().min(1).max(256),
}).strict();
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
const webhookSchema = z.object({
  event: z.literal("media.update.status"),
  data: z.object({
    id: z.string().min(1).max(256),
    message: z.string().max(500).optional(),
    status: z.string().min(1).max(64),
  }).loose(),
}).loose();
const providerAuthorizationSchema = z.object({
  id: z.string().min(1).max(256),
  ip: z.string().optional(),
  token: z.string().min(1).max(4096),
  type: z.string().optional(),
  user_agent: z.string().optional(),
}).loose();

@MaterialAuthoringEndpoint()
@Controller("authoring")
export class VideoAuthoringController {
  constructor(@Inject(VIDEOS) private readonly videos: Videos) {}

  @Post("materials/:materialId/videos/uploads")
  @ApiOperation({ operationId: "initMaterialVideoUpload", summary: "Initialize a resumable primary Video upload" })
  @ApiHeader({ name: "idempotency-key", required: true })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiBody({ schema: toOpenApiSchema(initBodySchema) })
  @ApiCreatedResponse({ schema: toOpenApiSchema(initResponseSchema) })
  async initUpload(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("materialId") materialId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: unknown,
  ) {
    const body = parse(initBodySchema, input);
    const result = await this.videos.initUpload({
      ...body,
      actor: current.accountId,
      idempotencyKey: idempotencyKey ?? "",
      materialId,
    });
    if (!result.ok) throwVideoError(result.error);
    return result.value;
  }

  @Post("materials/:materialId/videos/attach")
  @ApiOperation({ operationId: "attachMaterialVideo", summary: "Attach an existing Video from the configured project" })
  @ApiBody({ schema: toOpenApiSchema(attachBodySchema) })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiCreatedResponse({ schema: toOpenApiSchema(videoSchema) })
  async attach(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("materialId") materialId: string,
    @Body() input: unknown,
  ) {
    const body = parse(attachBodySchema, input);
    const result = await this.videos.attachExisting({ ...body, actor: current.accountId, materialId });
    if (!result.ok) throwVideoError(result.error);
    return result.value;
  }

  @Post("videos/:videoId/reconcile")
  @HttpCode(200)
  @ApiOperation({ operationId: "reconcileMaterialVideo", summary: "Reconcile Video lifecycle from Kinescope" })
  @ApiParam({ name: "videoId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(videoSchema) })
  async reconcile(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("videoId") videoId: string,
  ) {
    const result = await this.videos.reconcile({ actor: current.accountId, videoId });
    if (!result.ok) throwVideoError(result.error);
    return result.value;
  }
}

@ApiTags("Video playback")
@PrivateNoStore()
@OptionalAccountEndpoint()
@Controller("materials")
export class VideoPlaybackController {
  constructor(@Inject(VIDEO_PLAYBACK) private readonly playback: VideoPlaybackService) {}

  @Post(":materialId/videos/:videoId/playback")
  @HttpCode(200)
  @ApiOperation({ operationId: "createVideoPlaybackSession", summary: "Authorize and create a short-lived Video playback session" })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiParam({ name: "videoId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(playbackSchema) })
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
  constructor(@Inject(VIDEO_PLAYBACK) private readonly playback: VideoPlaybackService) {}

  @Put(":materialId/videos/:videoId/progress")
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiBody({ schema: toOpenApiSchema(progressSchema) })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiParam({ name: "videoId", schema: toOpenApiSchema(z.uuid()) })
  async save(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("materialId") materialId: string,
    @Param("videoId") videoId: string,
    @Body() input: unknown,
  ): Promise<void> {
    const body = parse(progressSchema, input);
    const saved = await this.playback.saveProgress({
      accountId: current.accountId,
      materialId,
      videoId,
      ...body,
    });
    if (!saved) throw new ForbiddenException();
  }
}

@ApiTags("Kinescope integration")
@PrivateNoStore()
@Controller("integrations/kinescope/v1")
export class KinescopeIntegrationController {
  constructor(
    @Inject(VIDEOS) private readonly videos: Pick<Videos, "acceptWebhook">,
    @Inject(VIDEO_PLAYBACK) private readonly playback: Pick<VideoPlaybackService, "authorizeProvider">,
    @Inject(PLATFORM_CONFIG) private readonly config: Pick<PlatformConfig, "kinescope">,
  ) {}

  @Post("webhook")
  @HttpCode(200)
  async webhook(
    @Headers("authorization") authorization: string | undefined,
    @Body() input: unknown,
  ): Promise<{ readonly accepted: true }> {
    if (!basicMatches(
      authorization,
      this.config.kinescope.webhookUsername,
      this.config.kinescope.webhookPassword,
    )) throw new UnauthorizedException();
    const body = parse(webhookSchema, input);
    const accepted = await this.videos.acceptWebhook({
      event: body.event,
      providerStatus: body.data.status,
      providerVideoId: body.data.id,
    });
    if (!accepted.ok) throwVideoError(accepted.error);
    return { accepted: true };
  }

  @Post("authorize")
  @HttpCode(200)
  async authorize(
    @Headers("authorization") authorization: string | undefined,
    @Body() input: unknown,
  ): Promise<{ readonly authorized: true }> {
    if (!basicMatches(authorization, this.config.kinescope.callbackUsername, this.config.kinescope.callbackPassword)) {
      throw new UnauthorizedException();
    }
    const body = parse(providerAuthorizationSchema, input);
    if (!(await this.playback.authorizeProvider({ providerVideoId: body.id, token: body.token }))) {
      throw new ForbiddenException();
    }
    return { authorized: true };
  }
}

function parse<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpException({ code: "invalid_request", status: 400 }, 400);
  return parsed.data;
}

function throwVideoError(error: VideoError): never {
  const status = error.code === "forbidden" ? 403
    : error.code === "video_not_found" ? 404
      : error.code === "dependency_unavailable" ? 503
        : error.code === "invalid_request" ? 400
          : 409;
  throw new HttpException({ code: error.code, status, ...(error.code === "dependency_unavailable" ? { retryable: true } : {}) }, status);
}

function secretMatches(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function basicMatches(header: string | undefined, username: string, password: string): boolean {
  if (header === undefined || !header.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  return secretMatches(decoded, `${username}:${password}`);
}
