import { Global, Module } from "@nestjs/common";

import {
  RECIPIENT_LINKS,
  type RecipientLinks,
} from "../membership-entitlements/index.js";
import { TelegramAccountLinks } from "./facets/telegram-account-links/telegram-account-links.js";
import { TelegramAccountLinksModule } from "./telegram-account-links.module.js";

/**
 * Telegram Membership's implementation of the Membership Entitlements recipient links port.
 * Global, because Membership Entitlements must not import Telegram Membership; each process that
 * loads Membership Entitlements imports this module in its entrypoint.
 */
@Global()
@Module({
  imports: [TelegramAccountLinksModule],
  providers: [
    {
      provide: RECIPIENT_LINKS,
      inject: [TelegramAccountLinks],
      useFactory: (links: TelegramAccountLinks): RecipientLinks => links,
    },
  ],
  exports: [RECIPIENT_LINKS],
})
export class RecipientLinksModule {}
