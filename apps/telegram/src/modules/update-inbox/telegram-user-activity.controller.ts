import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Header,
  Inject,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { telegramActivityRequestSchema } from "@inside/contracts/telegram-activity";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { bearerMatches } from "../../security/credentials.js";
import { TelegramUserActivity } from "./telegram-user-activity.js";

@Controller("integrations/platform/v1/participant-activity")
export class TelegramUserActivityController {
  constructor(
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(TelegramUserActivity)
    private readonly activity: Pick<TelegramUserActivity, "read">,
  ) {}
  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async read(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    if (!bearerMatches(authorization, this.config.platformIntegrationSecret))
      throw new UnauthorizedException();
    const parsed = telegramActivityRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return this.activity.read({ from: parsed.data.from, to: parsed.data.to });
  }
}
