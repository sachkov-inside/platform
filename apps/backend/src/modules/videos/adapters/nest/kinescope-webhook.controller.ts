import { Body, Controller, Headers, HttpCode, HttpException, Inject, Post } from "@nestjs/common";
import { ApiBasicAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import { PLATFORM_CONFIG, type PlatformConfig } from "../../../../config/platform-config.js";
import { basicCredentialsMatch } from "../../../../infrastructure/http/basic-credentials.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { VIDEOS } from "../../videos.module.js";
import type { Videos } from "../../facets/videos/videos.interface.js";

const webhookSchema = z.object({
  event: z.literal("media.update.status"),
  data: z.object({
    id: z.string().min(1).max(256),
    message: z.string().max(500).optional(),
    status: z.string().min(1).max(64),
  }).loose(),
}).loose();
const acceptedSchema = z.object({ accepted: z.literal(true) }).strict();
@ApiTags("Kinescope integration")
@ApiBasicAuth("kinescope-webhook")
@PrivateNoStore()
@Controller("integrations/kinescope/v1")
export class KinescopeWebhookController {
  constructor(
    @Inject(VIDEOS) private readonly videos: Pick<Videos, "acceptWebhook">,
    @Inject(PLATFORM_CONFIG) private readonly config: Pick<PlatformConfig, "kinescope">,
  ) {}

  @Post("webhook")
  @HttpCode(200)
  @ApiOperation({ operationId: "acceptKinescopeVideoWebhook", summary: "Accept and durably reconcile a Kinescope Video status event" })
  @ApiBody({ schema: toOpenApiSchema(webhookSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(acceptedSchema) })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ["invalid_request"])) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problemDetailsSchema(401, ["invalid_basic_credentials"])) })
  @ApiResponse({ status: 404, content: problemDetailsContent(problemDetailsSchema(404, ["video_not_found"])) })
  @ApiResponse({ status: 409, content: problemDetailsContent(problemDetailsSchema(409, ["provider_mismatch"])) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problemDetailsSchema(503, ["dependency_unavailable"])) })
  async webhook(
    @Headers("authorization") authorization: string | undefined,
    @Body() input: unknown,
  ): Promise<{ readonly accepted: true }> {
    if (!basicCredentialsMatch(
      authorization,
      this.config.kinescope.webhookUsername,
      this.config.kinescope.webhookPassword,
    )) throw new HttpException({ code: "invalid_basic_credentials", status: 401 }, 401);
    const parsed = webhookSchema.safeParse(input);
    if (!parsed.success) throw new HttpException({ code: "invalid_request", status: 400 }, 400);
    const accepted = await this.videos.acceptWebhook({
      event: parsed.data.event,
      providerStatus: parsed.data.data.status,
      providerVideoId: parsed.data.data.id,
    });
    if (!accepted.ok) {
      switch (accepted.error.code) {
        case "invalid_request": throw new HttpException({ code: accepted.error.code, status: 400 }, 400);
        case "video_not_found": throw new HttpException({ code: accepted.error.code, status: 404 }, 404);
        case "provider_mismatch": throw new HttpException({ code: accepted.error.code, status: 409 }, 409);
        case "dependency_unavailable": throw new HttpException({ code: accepted.error.code, status: 503, retryable: true }, 503);
        default: return assertNever(accepted.error);
      }
    }
    return { accepted: true };
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Kinescope webhook error: ${JSON.stringify(value)}`);
}
