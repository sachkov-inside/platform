import type { FastifyRequest } from "fastify";
import { admitInternalWaitlistParent } from "@inside/contracts/internal-waitlist-parent";
import { runAuthenticatedWaitlistAuthorization } from "../../../../infrastructure/observability/technical-telemetry.js";
import {
  waitlistConfirmationSchema,
  waitlistConfirmationResultSchema,
} from "@inside/contracts/waitlist-confirmation";
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
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
import { ProductDirectory } from "../../../materials/index.js";
import { BillingPricing } from "../../../billing/index.js";
import { ProductWaitlists } from "../../../sales-funnel/index.js";
import { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import {
  waitlistAudienceRequestSchema,
  waitlistAudienceResponseSchema,
} from "../../communications-schema.generated.js";
import { readWaitlistAudience } from "./read-waitlist-audience.js";

const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.enum([
    "unauthorized",
    "malformed",
    "validation_unavailable",
    "forbidden",
  ]),
});

@ApiTags("Communications")
@ApiBearerAuth("telegram-communications")
@PrivateNoStore()
@Controller("integrations/telegram/v1/communications/waitlist")
export class ReadWaitlistAudienceController {
  constructor(
    @Inject(ACCOUNTS) private readonly accounts: Accounts,
    @Inject(TelegramAccountLinks) private readonly links: TelegramAccountLinks,
    @Inject(ProductDirectory) private readonly products: ProductDirectory,
    @Inject(BillingPricing) private readonly pricing: BillingPricing,
    @Inject(ProductWaitlists) private readonly waitlists: ProductWaitlists,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: "readTelegramWaitlistAudience",
    summary:
      "Derive an active intake notification audience or recheck one dispatch recipient",
  })
  @ApiBody({
    schema: toOpenApiSchema(
      z.union([waitlistAudienceRequestSchema, waitlistConfirmationSchema]),
    ),
  })
  @ApiOkResponse({
    schema: toOpenApiSchema(
      z.union([
        waitlistAudienceResponseSchema,
        waitlistConfirmationResultSchema,
      ]),
    ),
  })
  @ApiResponse({ status: 400, content: problemDetailsContent(problemSchema) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problemSchema) })
  @ApiResponse({ status: 403, content: problemDetailsContent(problemSchema) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problemSchema) })
  async validate(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
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
    const confirmation = waitlistConfirmationSchema.safeParse(body);
    if (confirmation.success) {
      return runAuthenticatedWaitlistAuthorization(
        admitInternalWaitlistParent(request.raw.rawHeaders),
        async () => {
          const status = await this.waitlists.confirmationCurrent(
            confirmation.data,
          );
          if (status === "unavailable")
            throw problemException(
              503,
              "validation_unavailable",
              "Waitlist confirmation unavailable",
            );
          return { eventId: confirmation.data.eventId, status };
        },
      );
    }
    const parsed = waitlistAudienceRequestSchema.safeParse(body);
    if (!parsed.success)
      throw problemException(
        400,
        "malformed",
        "Invalid waitlist audience request",
      );
    const result = await readWaitlistAudience(
      {
        accounts: this.accounts,
        links: this.links,
        products: this.products,
        pricing: this.pricing,
        waitlists: this.waitlists,
        botIdentity: config.botIdentity,
        publicOrigin: config.publicOrigin,
      },
      parsed.data,
    );
    if (result.status === "unavailable")
      throw problemException(
        503,
        "validation_unavailable",
        "Waitlist eligibility unavailable",
      );
    if (result.status === "denied")
      throw problemException(403, "forbidden", "Author permission required");
    return result;
  }
}
