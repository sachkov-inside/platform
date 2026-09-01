import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";

import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import {
  AccountGuard,
  AccountProblemDetailsFilter,
  CurrentAccount,
  type AuthenticatedAccount,
} from "../../../accounts/index.js";
import { VIDEOS } from "../../videos.module.js";
import type { VideoError, Videos } from "../../facets/videos/videos.interface.js";

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
  byteSize: z.number().int().positive().max(20 * 1024 * 1024 * 1024),
  filename: z.string().min(1).max(255),
  title: z.string().min(1).max(255),
}).strict();
const initResponseSchema = z.object({ uploadEndpoint: z.url(), video: videoSchema }).strict();
const attachmentBodySchema = z.object({
  access: z.enum(["free", "membership"]),
  providerVideoId: z.string().min(1).max(256),
}).strict();
const videoProblemSchema = z.object({
  code: z.enum([
    "dependency_unavailable",
    "forbidden",
    "idempotency_key_reused",
    "invalid_request",
    "provider_mismatch",
    "upload_outcome_unknown",
    "video_not_found",
    "video_not_ready",
  ]),
  status: z.number().int(),
  title: z.string(),
  type: z.string(),
}).loose();

@ApiTags("Material video authoring")
@ApiBearerAuth("logto")
@PrivateNoStore()
@UseGuards(AccountGuard)
@UseFilters(AccountProblemDetailsFilter)
@Controller("authoring")
export class VideoAuthoringController {
  constructor(@Inject(VIDEOS) private readonly videos: Videos) {}

  @Post("materials/:materialId/videos/uploads")
  @ApiOperation({ operationId: "initMaterialVideoUpload", summary: "Initialize a resumable primary Video upload" })
  @ApiHeader({
    name: "idempotency-key",
    required: true,
    schema: toOpenApiSchema(z.string().min(1).max(128)),
  })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiBody({ schema: toOpenApiSchema(initBodySchema) })
  @ApiCreatedResponse({ schema: toOpenApiSchema(initResponseSchema) })
  @VideoErrorResponses()
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
  @ApiBody({ schema: toOpenApiSchema(attachmentBodySchema) })
  @ApiParam({ name: "materialId", schema: toOpenApiSchema(z.uuid()) })
  @ApiCreatedResponse({ schema: toOpenApiSchema(videoSchema) })
  @VideoErrorResponses()
  async attach(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("materialId") materialId: string,
    @Body() input: unknown,
  ) {
    const body = parse(attachmentBodySchema, input);
    const result = await this.videos.attachExisting({ ...body, actor: current.accountId, materialId });
    if (!result.ok) throwVideoError(result.error);
    return result.value;
  }

  @Post("videos/:videoId/reconcile")
  @HttpCode(200)
  @ApiOperation({ operationId: "reconcileMaterialVideo", summary: "Reconcile Video lifecycle from Kinescope" })
  @ApiParam({ name: "videoId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(videoSchema) })
  @VideoErrorResponses()
  async reconcile(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("videoId") videoId: string,
  ) {
    const result = await this.videos.reconcile({ actor: current.accountId, videoId });
    if (!result.ok) throwVideoError(result.error);
    return result.value;
  }
}

function VideoErrorResponses(): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    for (const status of [400, 403, 404, 409, 503]) {
      ApiResponse({ status, content: problemDetailsContent(videoProblemSchema) })(target, propertyKey, descriptor);
    }
  };
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
