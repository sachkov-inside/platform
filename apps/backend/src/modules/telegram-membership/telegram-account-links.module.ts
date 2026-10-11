import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import { HttpTelegramContactsProvider } from "./infrastructure/http/http-telegram-contacts-provider.js";
import { Module } from "@nestjs/common";
import {
  PrismaClientProvider,
  PrismaModule,
} from "../../infrastructure/prisma/index.js";
import { TelegramAccountLinks } from "./facets/telegram-account-links/telegram-account-links.js";

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: TelegramAccountLinks,
      inject: [PrismaClientProvider, PLATFORM_CONFIG],
      useFactory: (prisma: PrismaClientProvider, config: PlatformConfig) =>
        new TelegramAccountLinks(
          prisma,
          new HttpTelegramContactsProvider(
            config.telegramMembership.linkingEndpoint,
            config.telegramMembership.linkingSecret,
          ),
        ),
    },
  ],
  exports: [TelegramAccountLinks],
})
export class TelegramAccountLinksModule {}
