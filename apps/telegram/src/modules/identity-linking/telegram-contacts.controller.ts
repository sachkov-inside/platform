import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import {
  telegramContactsRequestSchema,
  telegramContactsResponseSchema,
} from "@inside/contracts/telegram-contact";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { bearerMatches } from "../../security/credentials.js";
import { TelegramContacts } from "./telegram-contacts.js";

@Controller("integrations/platform/v1/telegram-contacts")
export class TelegramContactsController {
  constructor(
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(TelegramContacts) private readonly contacts: TelegramContacts,
  ) {}
  @Post()
  @HttpCode(200)
  async read(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    if (!bearerMatches(authorization, this.config.platformIntegrationSecret))
      throw new UnauthorizedException();
    const parsed = telegramContactsRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return telegramContactsResponseSchema.parse({
      contractVersion: parsed.data.contractVersion,
      contacts: await this.contacts.read(parsed.data.contacts),
    });
  }
}
