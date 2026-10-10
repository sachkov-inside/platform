import { CONTACT_EFFECTS, type ContactEffects } from "./contact-effects.js";
import { Inject, Injectable } from "@nestjs/common";

import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { DATABASE, type Database } from "../../database/database.js";
import type {
  VerifiedPrivateContactability,
  VerifiedPrivateStart,
} from "../../shared/telegram-contact.js";

export interface ContactOutcome {
  readonly contact: "created" | "reactivated" | "refreshed";
  readonly responsePlanned: boolean;
}

export type StartResponseKind = "link-receipt" | "welcome" | "none";

@Injectable()
export class BotContacts {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG)
    private readonly config: ApplicationConfig,
    @Inject(CONTACT_EFFECTS) private readonly effects: ContactEffects,
  ) {}

  async observeStart(
    start: VerifiedPrivateStart,
    responseKind: StartResponseKind = "welcome",
  ): Promise<ContactOutcome> {
    return this.database.transaction().execute(async (transaction) => {
      // Only this BotContact is serialized: marketing dispatch and planning never delay /start.
      await this.effects.lock(
        transaction,
        this.config.botIdentity,
        start.telegramUserId,
      );
      const existing = await transaction
        .selectFrom("bot_contacts")
        .select("contactability")
        .where("bot_identity", "=", start.botIdentity)
        .where("telegram_user_id", "=", start.telegramUserId)
        .forNoKeyUpdate()
        .executeTakeFirst();

      await this.effects.availability(
        transaction,
        start.botIdentity,
        start.telegramUserId,
        start.observedAt,
        true,
      );
      let contact: ContactOutcome["contact"];
      if (!existing) {
        await transaction
          .insertInto("bot_contacts")
          .values({
            bot_identity: start.botIdentity,
            contactability: "reachable",
            first_started_at: start.observedAt,
            last_started_at: start.observedAt,
            private_chat_id: start.privateChatId,
            telegram_user_id: start.telegramUserId,
            updated_at: start.observedAt,
          })
          .execute();
        contact = "created";
      } else {
        await transaction
          .updateTable("bot_contacts")
          .set({
            contactability: "reachable",
            last_started_at: start.observedAt,
            private_chat_id: start.privateChatId,
            updated_at: start.observedAt,
          })
          .where("bot_identity", "=", start.botIdentity)
          .where("telegram_user_id", "=", start.telegramUserId)
          .execute();
        contact =
          existing.contactability === "blocked" ? "reactivated" : "refreshed";
      }

      await this.effects.ensure(
        transaction,
        start.botIdentity,
        start.telegramUserId,
      );

      await transaction
        .insertInto("bot_contact_events")
        .values({
          bot_identity: start.botIdentity,
          contactability: "reachable",
          event_type: "start_observed",
          observed_at: start.observedAt,
          telegram_user_id: start.telegramUserId,
          update_id: start.updateId,
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();

      if (responseKind === "none") return { contact, responsePlanned: false };

      const responsePlanned = await this.effects.reply(
        transaction,
        start,
        responseKind === "link-receipt"
          ? this.config.linkReceiptText
          : this.config.welcomeText,
      );

      return { contact, responsePlanned };
    });
  }

  async observeContactability(
    observation: VerifiedPrivateContactability,
  ): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      await this.effects.lock(
        transaction,
        this.config.botIdentity,
        observation.telegramUserId,
      );
      await this.effects.availability(
        transaction,
        observation.botIdentity,
        observation.telegramUserId,
        observation.observedAt,
        observation.contactability === "reachable",
      );
      const contact = await transaction
        .updateTable("bot_contacts")
        .set({
          contactability: observation.contactability,
          updated_at: observation.observedAt,
        })
        .where("bot_identity", "=", observation.botIdentity)
        .where("telegram_user_id", "=", observation.telegramUserId)
        .returning("telegram_user_id")
        .executeTakeFirst();

      if (!contact) {
        return false;
      }

      await transaction
        .insertInto("bot_contact_events")
        .values({
          bot_identity: observation.botIdentity,
          contactability: observation.contactability,
          event_type: "contactability_observed",
          observed_at: observation.observedAt,
          telegram_user_id: observation.telegramUserId,
          update_id: observation.updateId,
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
      return true;
    });
  }
}
