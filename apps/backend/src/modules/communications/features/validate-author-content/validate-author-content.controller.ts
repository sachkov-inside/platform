import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { z } from "zod";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../../../config/platform-config.js";
import {
  bearerCredential,
  credentialsMatch,
} from "../../../../infrastructure/http/bearer-credentials.js";
import { PrivateNoStore } from "../../../../infrastructure/http/http-cache-policy.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import { ACCOUNTS, type Accounts } from "../../../accounts/index.js";
import { PublicContentTargets } from "../../../materials/index.js";
import { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import {
  contentValidationRequestSchema,
  contentValidationResponseSchema,
} from "../../communications-schema.generated.js";
import { validateAuthorContent } from "./validate-author-content.js";

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(["unauthorized", "malformed", "validation_unavailable"]),
});

@ApiTags("Communications")
@ApiBearerAuth("telegram-communications")
@PrivateNoStore()
@Controller("integrations/telegram/v1/communications/validate-content")
export class ValidateAuthorContentController {
  constructor(
    @Inject(ACCOUNTS) private readonly accounts: Accounts,
    @Inject(TelegramAccountLinks) private readonly links: TelegramAccountLinks,
    @Inject(PublicContentTargets)
    private readonly targets: PublicContentTargets,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: "validateTelegramAuthorContent",
    summary:
      "Check public Material and Series targets in an immutable author content snapshot",
  })
  @ApiBody({ schema: toOpenApiSchema(contentValidationRequestSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(contentValidationResponseSchema) })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemSchema) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problemSchema) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problemSchema) })
  async validate(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const config = this.config.communications;
    if (
      !config ||
      !credentialsMatch(
        bearerCredential(authorization),
        config.authorizationSecret,
      )
    )
      throw new HttpException({ code: "unauthorized" }, 401);
    const parsed = contentValidationRequestSchema.safeParse(body);
    if (!parsed.success) throw new HttpException({ code: "malformed" }, 400);
    const result = await validateAuthorContent(
      {
        accounts: this.accounts,
        links: this.links,
        targets: this.targets,
        botIdentity: config.botIdentity,
        publicOrigin: config.publicOrigin,
      },
      parsed.data,
    );
    if (result.status === "unavailable")
      throw new HttpException({ code: "validation_unavailable" }, 503);
    return result;
  }
}
