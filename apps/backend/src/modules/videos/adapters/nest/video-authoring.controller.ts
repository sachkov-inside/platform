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
import { VIDEOS } from "../../videos.module.js";
import type { VideoError, Videos } from "../../facets/videos/videos.interface.js";

const videoSchema = z.object({
  access: z.enum(["free", "membership"]),
  failureCode: z.string().optional(),
  materialId: z.uuid(),
  origin: z.enum(["external_attachment", "platform_upload"]),
  state: z.enum([
    "uploading",
    "processing",
    "ready",
    "failed",
    "deletion_requested",
    "deleting",
    "deleted",
    "delete_failed",
  ]),
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
  @VideoErrorResponses({
    400: ["invalid_request"],
    403: ["forbidden"],
    409: ["idempotency_key_reused", "upload_outcome_unknown"],
    503: ["dependency_unavailable"],
  })
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
  @VideoErrorResponses({
    400: ["invalid_request"],
    403: ["forbidden"],
    409: ["provider_mismatch"],
    503: ["dependency_unavailable"],
  })
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
  @VideoErrorResponses({
    400: ["invalid_request"],
    403: ["forbidden"],
    404: ["video_not_found"],
    409: ["provider_mismatch"],
    503: ["dependency_unavailable"],
  })
  async reconcile(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("videoId") videoId: string,
  ) {
    const result = await this.videos.reconcile({ actor: current.accountId, videoId });
    if (!result.ok) throwVideoError(result.error);
    return result.value;
  }

  @Post("videos/:videoId/deletion-retries")
  @HttpCode(200)
  @ApiOperation({
    operationId: "retryMaterialVideoDeletion",
    summary: "Retry one failed owned Video deletion",
  })
  @ApiParam({ name: "videoId", schema: toOpenApiSchema(z.uuid()) })
  @ApiOkResponse({ schema: toOpenApiSchema(videoSchema) })
  @VideoErrorResponses({
    400: ["invalid_request"],
    403: ["forbidden"],
    404: ["video_not_found"],
    409: ["video_deletion_not_retryable"],
    503: ["dependency_unavailable"],
  })
  async retryDeletion(
    @CurrentAccount() current: AuthenticatedAccount,
    @Param("videoId") videoId: string,
  ) {
    const result = await this.videos.retryDeletion({
      actor: current.accountId,
      videoId,
    });
    if (!result.ok) throwVideoError(result.error);
    return result.value;
  }
}

type VideoProblemCodes = Partial<Record<400 | 403 | 404 | 409 | 503, readonly [VideoError["code"], ...VideoError["code"][]]>>;

function VideoErrorResponses(codes: VideoProblemCodes): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    for (const status of [400, 401, 403, 404, 409, 500, 503] as const) {
      const videoCodes = status === 401 || status === 500 ? undefined : codes[status];
      const accountFailure = status === 400 || status === 401 || status === 409 || status === 500 || status === 503;
      if (videoCodes === undefined && !accountFailure) continue;
      const videoSchema = videoCodes === undefined ? undefined : problemDetailsSchema(status, videoCodes);
      const content = videoSchema === undefined
        ? problemDetailsContent(accountProblemSchema)
        : accountFailure
          ? problemDetailsOneOfContent(videoSchema, accountProblemSchema)
          : problemDetailsContent(videoSchema);
      ApiResponse({ status, content })(target, propertyKey, descriptor);
    }
  };
}

function parse<Schema extends z.ZodType>(schema: Schema, input: unknown): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpException({ code: "invalid_request", status: 400 }, 400);
  return parsed.data;
}

function throwVideoError(error: VideoError): never {
  switch (error.code) {
    case "invalid_request": throw videoException(400, error.code);
    case "forbidden": throw videoException(403, error.code);
    case "video_not_found": throw videoException(404, error.code);
    case "idempotency_key_reused":
    case "provider_mismatch":
    case "upload_outcome_unknown":
    case "video_deletion_not_retryable":
    case "video_not_ready": throw videoException(409, error.code);
    case "dependency_unavailable": throw videoException(503, error.code, true);
    default: return assertNever(error);
  }
}

function videoException(status: number, code: VideoError["code"], retryable = false): HttpException {
  return new HttpException({ code, status, ...(retryable ? { retryable: true } : {}) }, status);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Video authoring error: ${JSON.stringify(value)}`);
}
