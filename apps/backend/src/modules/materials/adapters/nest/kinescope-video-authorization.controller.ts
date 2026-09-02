import { Body, Controller, Headers, HttpCode, HttpException, Inject, Post } from "@nestjs/common";
import { ApiBasicAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";

import { PLATFORM_CONFIG, type PlatformConfig } from "../../../../config/platform-config.js";
import { basicCredentialsMatch } from "../../../../infrastructure/http/basic-credentials.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, problemDetailsSchema, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { VIDEO_PLAYBACK, type VideoPlayback } from "../../facets/video-playback/video-playback.js";

const authorizationSchema = z.object({
  id: z.string().min(1).max(256),
  ip: z.string().optional(),
  token: z.string().min(1).max(4096),
  type: z.string().optional(),
  user_agent: z.string().optional(),
}).loose();
const authorizedSchema = z.object({ authorized: z.literal(true) }).strict();
@ApiTags("Kinescope integration")
@ApiBasicAuth("kinescope-callback")
@PrivateNoStore()
@Controller("integrations/kinescope/v1")
export class KinescopeVideoAuthorizationController {
  constructor(
    @Inject(VIDEO_PLAYBACK) private readonly playback: Pick<VideoPlayback, "authorizeProvider">,
    @Inject(PLATFORM_CONFIG) private readonly config: Pick<PlatformConfig, "kinescope">,
  ) {}

  @Post("authorize")
  @HttpCode(200)
  @ApiOperation({ operationId: "authorizeKinescopeVideoPlayback", summary: "Repeat the member access decision for a Kinescope DRM request" })
  @ApiBody({ schema: toOpenApiSchema(authorizationSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(authorizedSchema) })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemDetailsSchema(400, ["invalid_request"])) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problemDetailsSchema(401, ["invalid_basic_credentials"])) })
  @ApiResponse({ status: 403, content: problemDetailsContent(problemDetailsSchema(403, ["access_denied"])) })
  async authorize(
    @Headers("authorization") authorization: string | undefined,
    @Body() input: unknown,
  ): Promise<{ readonly authorized: true }> {
    if (!basicCredentialsMatch(
      authorization,
      this.config.kinescope.callbackUsername,
      this.config.kinescope.callbackPassword,
    )) throw new HttpException({ code: "invalid_basic_credentials", status: 401 }, 401);
    const parsed = authorizationSchema.safeParse(input);
    if (!parsed.success) throw new HttpException({ code: "invalid_request", status: 400 }, 400);
    if (!(await this.playback.authorizeProvider({ providerVideoId: parsed.data.id, token: parsed.data.token }))) {
      throw new HttpException({ code: "access_denied", status: 403 }, 403);
    }
    return { authorized: true };
  }
}
