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
import { findPlatformLink } from "./platform-links.js";
import {
  TELEGRAM_CONTACT_PROFILE,
  type TelegramContactProfile,
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
    const contacts: TelegramContact[] = [];
    // Limit concurrent Telegram requests; the whole batch shares the upstream request budget.
    for (let index = 0; index < queries.length; index += 4) {
      contacts.push(
        ...(await Promise.all(
          queries
            .slice(index, index + 4)
            .map((query) => this.readContact(query, signal)),
        )),
      );
    }
    return contacts;
  }
  private async readContact(
    query: TelegramContactQuery,
    signal: AbortSignal,
  ): Promise<TelegramContact> {
    const empty = { ...query, displayName: null, username: null };
    const match = { ...query, botIdentity: this.config.botIdentity };
    const link = await findPlatformLink(this.database, match);
    if (link === undefined) return { ...empty, status: "not_found" };
    if (signal.aborted) return { ...empty, status: "unavailable" };
    const profile = await this.profile.read(link.telegramUserId, signal);
    const current = await findPlatformLink(this.database, match);
    if (
      current === undefined ||
      current.telegramUserId !== link.telegramUserId ||
      current.linkTransactionRef !== link.linkTransactionRef
    )
      return { ...empty, status: "not_found" };
    return profile.kind === "available"
      ? {
          ...query,
          status: "available",
          displayName: profile.displayName,
          username: profile.username,
        }
      : { ...empty, status: "unavailable" };
  }
}
