import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  Body,
  Controller,
  Headers,
  HttpCode,
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
import {
  ACCOUNT_RIGHTS,
  type AccountRights,
} from "../../../account-rights/index.js";
import { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import {
  productAccessRequestSchema,
  productAccessResponseSchema,
} from "../../communications-schema.generated.js";
import { readProductAccess } from "./read-product-access.js";

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum(["unauthorized", "malformed", "validation_unavailable"]),
});

@ApiTags("Communications")
@ApiBearerAuth("telegram-communications")
@PrivateNoStore()
@Controller("integrations/telegram/v2/communications/product-access")
export class ReadProductAccessController {
  constructor(
    @Inject(TelegramAccountLinks) private readonly links: TelegramAccountLinks,
    @Inject(ACCOUNT_RIGHTS) private readonly rights: AccountRights,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: "readTelegramProductAccess",
    summary:
      "Report which Telegram identities belong to an Account with Product Access",
  })
  @ApiBody({ schema: toOpenApiSchema(productAccessRequestSchema) })
  @ApiOkResponse({ schema: toOpenApiSchema(productAccessResponseSchema) })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemSchema) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problemSchema) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problemSchema) })
  async read(
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
      throw problemException(
        401,
        "unauthorized",
        "Service authentication required",
      );
    const parsed = productAccessRequestSchema.safeParse(body);
    if (!parsed.success)
      throw problemException(
        400,
        "malformed",
        "Invalid product access request",
      );
    const result = await readProductAccess(
      { links: this.links, rights: this.rights },
      parsed.data,
    );
    if (result.status === "unavailable")
      throw problemException(
        503,
        "validation_unavailable",
        "Product access unavailable",
      );
    return result.response;
  }
}
