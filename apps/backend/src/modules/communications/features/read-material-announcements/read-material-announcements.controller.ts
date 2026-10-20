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
import {
  materialAnnouncementsRequestSchema,
  materialAnnouncementsResponseSchema,
} from "@inside/contracts/material-announcements";
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
import { problemException } from "../../../../infrastructure/http/problem-details.js";
import {
  problemDetailsContent,
  toOpenApiSchema,
} from "../../../../infrastructure/http/zod-openapi.js";
import { PublicMaterialAnnouncements } from "../../../materials/index.js";
const problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
});

@ApiTags("Communications")
@ApiBearerAuth("telegram-communications")
@PrivateNoStore()
@Controller("integrations/telegram/v1/communications/materials")
export class ReadMaterialAnnouncementsController {
  constructor(
    @Inject(PublicMaterialAnnouncements)
    private readonly announcements: PublicMaterialAnnouncements,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}
  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: "readTelegramMaterialAnnouncements",
    summary: "Read or recheck current public feed announcements",
  })
  @ApiBody({ schema: toOpenApiSchema(materialAnnouncementsRequestSchema) })
  @ApiOkResponse({
    schema: toOpenApiSchema(materialAnnouncementsResponseSchema),
  })
  @ApiResponse({ status: 400, content: problemDetailsContent(problem) })
  @ApiResponse({ status: 401, content: problemDetailsContent(problem) })
  @ApiResponse({ status: 503, content: problemDetailsContent(problem) })
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
    const parsed = materialAnnouncementsRequestSchema.safeParse(body);
    if (
      !parsed.success ||
      (parsed.data.after !== undefined &&
        parsed.data.announcementRef !== undefined)
    )
      throw problemException(400, "malformed", "Invalid announcement query");
    if (config.publicOrigin === undefined)
      throw problemException(
        503,
        "unavailable",
        "Public origin is not configured",
      );
    return this.announcements.read(
      parsed.data,
      config.publicOrigin,
      new Date(),
    );
  }
}
