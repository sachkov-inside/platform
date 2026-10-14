import { Inject, Injectable } from "@nestjs/common";
import type {
  TelegramContact,
  TelegramContactQuery,
} from "@inside/contracts/telegram-contact";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { DATABASE, type Database } from "../../database/database.js";
import { findPlatformContactLinks } from "./platform-links.js";
import {
  TELEGRAM_CONTACT_PROFILE,
  type TelegramContactProfile,
  type ContactProfileResult,
} from "./telegram-contact-profile.js";

@Injectable()
export class TelegramContacts {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(TELEGRAM_CONTACT_PROFILE)
    private readonly profile: TelegramContactProfile,
  ) {}
  async read(
    queries: readonly TelegramContactQuery[],
  ): Promise<readonly TelegramContact[]> {
    const signal = AbortSignal.timeout(3_500);
    const links = await findPlatformContactLinks(
      this.database,
      this.config.botIdentity,
      queries,
    );
    const profiles: (ContactProfileResult | undefined)[] = [];
    // Limit concurrent Telegram requests; the whole batch shares the upstream request budget.
    for (let index = 0; index < queries.length; index += 4) {
      profiles.push(
        ...(await Promise.all(
          links
            .slice(index, index + 4)
            .map((link) =>
              link === undefined || signal.aborted
                ? Promise.resolve(undefined)
                : this.profile.read(link.telegramUserId, signal),
            ),
        )),
      );
    }
    // Revalidate after all provider reads, so a transfer/unlink never exposes an old profile.
    const current = await findPlatformContactLinks(
      this.database,
      this.config.botIdentity,
      queries,
    );
    return queries.map((query, index) => {
      const empty = { ...query, displayName: null, username: null };
      const link = links[index];
      const binding = current[index];
      if (
        link === undefined ||
        binding === undefined ||
        binding.telegramUserId !== link.telegramUserId ||
        binding.linkTransactionRef !== link.linkTransactionRef
      )
        return { ...empty, status: "not_found" };
      const profile = profiles[index];
      return profile?.kind === "available"
        ? {
            ...query,
            status: "available",
            displayName: profile.displayName,
            username: profile.username,
          }
        : { ...empty, status: "unavailable" };
    });
  }
}
