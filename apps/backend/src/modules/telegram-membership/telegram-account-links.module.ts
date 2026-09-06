import { Module } from "@nestjs/common";
import { PrismaClientProvider, PrismaModule } from "../../infrastructure/prisma/index.js";
import { TelegramAccountLinks } from "./facets/telegram-account-links/telegram-account-links.js";

@Module({
  imports: [PrismaModule],
  providers: [{ provide: TelegramAccountLinks, inject: [PrismaClientProvider], useFactory: (prisma: PrismaClientProvider) => new TelegramAccountLinks(prisma) }],
  exports: [TelegramAccountLinks],
})
export class TelegramAccountLinksModule {}
