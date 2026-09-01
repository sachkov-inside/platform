import { Body, Controller, Headers, HttpCode, HttpException, Inject, Post, UnauthorizedException } from "@nestjs/common";
import { ApiBasicAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import { PLATFORM_CONFIG, type PlatformConfig } from "../../../../config/platform-config.js";
import { basicCredentialsMatch } from "../../../../infrastructure/http/basic-credentials.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
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
const integrationProblemSchema = z.object({
  code: z.string(),
  status: z.number().int(),
  title: z.string(),
  type: z.string(),
}).loose();

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
  @ApiResponse({ status: 400, content: problemDetailsContent(integrationProblemSchema) })
  @ApiResponse({ status: 401, content: problemDetailsContent(integrationProblemSchema) })
  @ApiResponse({ status: 503, content: problemDetailsContent(integrationProblemSchema) })
  async webhook(
    @Headers("authorization") authorization: string | undefined,
    @Body() input: unknown,
  ): Promise<{ readonly accepted: true }> {
    if (!basicCredentialsMatch(
      authorization,
      this.config.kinescope.webhookUsername,
      this.config.kinescope.webhookPassword,
    )) throw new UnauthorizedException();
    const parsed = webhookSchema.safeParse(input);
    if (!parsed.success) throw new HttpException({ code: "invalid_request", status: 400 }, 400);
    const accepted = await this.videos.acceptWebhook({
      event: parsed.data.event,
      providerStatus: parsed.data.data.status,
      providerVideoId: parsed.data.data.id,
    });
    if (!accepted.ok) {
      throw new HttpException({ code: accepted.error.code, status: 503, retryable: true }, 503);
    }
    return { accepted: true };
  }
}
