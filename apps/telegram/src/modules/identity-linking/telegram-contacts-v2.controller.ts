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
  normalizeTelegramContactSearchQuery,
  telegramContactSearchRequestSchema,
  telegramContactSearchResponseSchema,
  telegramContactsV2RequestSchema,
  telegramContactsV2ResponseSchema,
} from "@inside/contracts/telegram-contact-v2";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { bearerMatches } from "../../security/credentials.js";
import { LinkProfiles } from "./link-profiles.js";
import { TelegramContacts } from "./telegram-contacts.js";

/** `inside.telegram-contact.v2`: name search over current links and the read with `/stop` state. */
@Controller("integrations/platform/v2/telegram-contacts")
export class TelegramContactsV2Controller {
  constructor(
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(TelegramContacts) private readonly contacts: TelegramContacts,
    @Inject(LinkProfiles) private readonly profiles: LinkProfiles,
  ) {}

  @Post("search")
  @HttpCode(200)
  async search(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.authenticate(authorization);
    const parsed = telegramContactSearchRequestSchema.safeParse(body);
    const query = parsed.success
      ? normalizeTelegramContactSearchQuery(parsed.data.query)
      : undefined;
    if (!parsed.success || query === undefined) throw new BadRequestException();
    const result = await this.profiles.search(query, parsed.data.limit);
    return telegramContactSearchResponseSchema.parse({
      contractVersion: parsed.data.contractVersion,
      ...result,
    });
  }

  @Post("read")
  @HttpCode(200)
  async read(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    this.authenticate(authorization);
    const parsed = telegramContactsV2RequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException();
    return telegramContactsV2ResponseSchema.parse({
      contractVersion: parsed.data.contractVersion,
      contacts: await this.contacts.readWithMarketing(parsed.data.contacts),
    });
  }

  private authenticate(authorization: string | undefined): void {
    if (!bearerMatches(authorization, this.config.platformIntegrationSecret))
      throw new UnauthorizedException();
  }
}
