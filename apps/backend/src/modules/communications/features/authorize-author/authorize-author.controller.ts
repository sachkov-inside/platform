import { Body, Controller, Headers, HttpCode, HttpException, Inject, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { PLATFORM_CONFIG, type PlatformConfig } from "../../../../config/platform-config.js";
import { bearerCredential, credentialsMatch } from "../../../../infrastructure/http/bearer-credentials.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import { problemDetailsContent, toOpenApiSchema } from "../../../../infrastructure/http/zod-openapi.js";
import { ACCOUNTS, type Accounts } from "../../../accounts/index.js";
import { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import { authorizationRequestSchema, authorizationResponseSchema } from "../../communications-schema.generated.js";
import { authorizeAuthor } from "./authorize-author.js";

const problemSchema = z.object({ type: z.string(), title: z.string(), status: z.number().int(), code: z.enum(["unauthorized", "malformed", "authorization_unavailable"]) });

@ApiTags("Communications")
@ApiBearerAuth("telegram-communications")
@PrivateNoStore()
@Controller("integrations/telegram/v1/communications/authorize")
export class AuthorizeCommunicationsAuthorController {
  constructor(
    @Inject(ACCOUNTS) private readonly accounts: Accounts,
    @Inject(TelegramAccountLinks) private readonly links: TelegramAccountLinks,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: "authorizeTelegramCommunicationsAuthor", summary: "Verify a current confirmed author association and communications permission" })
  @ApiBody({ schema: toOpenApiSchema(authorizationRequestSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(authorizationResponseSchema) })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemSchema) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problemSchema) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problemSchema) })
  async authorize(@Headers("authorization") authorization: string | undefined, @Body() body: unknown) {
    const config = this.config.communications;
    if (config === undefined || !credentialsMatch(bearerCredential(authorization), config.authorizationSecret)) {
      throw new HttpException({ code: "unauthorized" }, 401);
    }
    const parsed = authorizationRequestSchema.safeParse(body);
    if (!parsed.success) throw new HttpException({ code: "malformed" }, 400);
    const result = await authorizeAuthor({ accounts: this.accounts, links: this.links, botIdentity: config.botIdentity }, parsed.data);
    if (result.status === "unavailable") throw new HttpException({ code: "authorization_unavailable" }, 503);
    return result;
  }
}
