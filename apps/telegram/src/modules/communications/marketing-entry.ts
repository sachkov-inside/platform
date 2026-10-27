import { decodeStoredSequenceDraft } from "./historical-sequence-decoder.js";
import { hasText } from "../../shared/text.js";
import { enqueueReply } from "../outbound/start-response-delivery-queue.js";
import { cancelDelivery } from "./sequence-timeline.js";
import { updateMarketingAvailability } from "./marketing-preferences.js";
import { randomUUID } from "node:crypto";
import {
  recordBotEntered,
  recordMarketingConsent,
} from "../sales-funnel/sales-funnel-events.js";
import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../database/database.js";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { CLOCK, type Clock } from "../../shared/clock.js";
import type { VerifiedPrivateStart } from "../../shared/telegram-contact.js";
import { contactLock, planDelivery } from "./communication-state.js";

@Injectable()
export class MarketingEntry {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}
  enabled(): boolean {
    return this.config.marketingEnabled;
  }
  /** Explicit `/stop` and `/resume` choices retain their historical event vocabulary. */
  async setPreference(
    start: VerifiedPrivateStart,
    enabled: boolean,
    via: "command" | "consent" = "command",
  ): Promise<void> {
    // Already committed old inbox commands remain readable, but cannot undo an explicit stop.
    if (via === "consent") return;
    await this.database.transaction().execute(async (tx) => {
      await contactLock(tx, this.config.botIdentity, start.telegramUserId);
      const prior = await tx
        .selectFrom("communication_preferences")
        .select("update_id")
        .where("bot_identity", "=", start.botIdentity)
        .where("update_id", "=", start.updateId)
        .executeTakeFirst();
      if (prior) return;
      await tx
        .insertInto("communication_contacts")
        .values({
          contact_id: randomUUID(),
          bot_identity: start.botIdentity,
          telegram_user_id: start.telegramUserId,
          marketing_enabled: true,
        })
        .onConflict((c) =>
          c.columns(["bot_identity", "telegram_user_id"]).doNothing(),
        )
        .execute();
      const contact = await tx
        .selectFrom("communication_contacts")
        .selectAll()
        .where("bot_identity", "=", start.botIdentity)
        .where("telegram_user_id", "=", start.telegramUserId)
        .executeTakeFirstOrThrow();
      const now = this.clock.now();
      await updateMarketingAvailability(
        tx,
        start.botIdentity,
        start.telegramUserId,
        now,
        true,
        enabled,
      );
      await tx
        .insertInto("communication_preferences")
        .values({
          bot_identity: start.botIdentity,
          update_id: start.updateId,
          contact_id: contact.contact_id,
          enabled,
          observed_at: now,
        })
        .execute();
      await recordMarketingConsent(tx, {
        botIdentity: start.botIdentity,
        updateId: start.updateId,
        contactRef: contact.contact_id,
        observedAt: now,
        granted: enabled,
      });
      await enqueueReply(tx, {
        botIdentity: start.botIdentity,
        telegramUserId: start.telegramUserId,
        privateChatId: start.privateChatId,
        messageText: enabled
          ? "Сообщения включены. Пропущенные сообщения не придут."
          : "Сообщения выключены. Чтобы включить их снова, отправьте /resume.",
        sourceKey: `marketing-preference:${start.botIdentity}:${start.updateId}`,
        triggerUpdateId: start.updateId,
        now,
      });
    });
  }
  /** A committed domain receipt, including retries after a worker crash. */
  async confirmedActivity(
    bot: string,
    update: string,
    user: string,
  ): Promise<"marketing_preference" | "marketing_entry" | undefined> {
    const preference = await this.database
      .selectFrom("communication_preferences")
      .innerJoin(
        "communication_contacts",
        "communication_contacts.contact_id",
        "communication_preferences.contact_id",
      )
      .select("communication_preferences.update_id")
      .where("communication_preferences.bot_identity", "=", bot)
      .where("communication_preferences.update_id", "=", update)
      .where("communication_contacts.bot_identity", "=", bot)
      .where("communication_contacts.telegram_user_id", "=", user)
      .executeTakeFirst();
    if (preference) return "marketing_preference";
    const entry = await this.database
      .selectFrom("communication_entries")
      .innerJoin(
        "communication_contacts",
        "communication_contacts.contact_id",
        "communication_entries.contact_id",
      )
      .select("communication_entries.update_id")
      .where("communication_entries.bot_identity", "=", bot)
      .where("communication_entries.update_id", "=", update)
      .where("communication_entries.outcome", "=", "entered")
      .where("communication_contacts.bot_identity", "=", bot)
      .where("communication_contacts.telegram_user_id", "=", user)
      .executeTakeFirst();
    return entry ? "marketing_entry" : undefined;
  }

  async enter(start: VerifiedPrivateStart, source?: string): Promise<void> {
    await this.database.transaction().execute(async (tx) => {
      await contactLock(tx, this.config.botIdentity, start.telegramUserId);
      const receipt = await tx
        .selectFrom("communication_entries")
        .select("outcome")
        .where("bot_identity", "=", start.botIdentity)
        .where("update_id", "=", start.updateId)
        .executeTakeFirst();
      if (receipt) return;
      await tx
        .insertInto("communication_contacts")
        .values({
          contact_id: randomUUID(),
          bot_identity: start.botIdentity,
          telegram_user_id: start.telegramUserId,
          marketing_enabled: true,
        })
        .onConflict((c) =>
          c.columns(["bot_identity", "telegram_user_id"]).doNothing(),
        )
        .execute();
      const contact = await tx
        .selectFrom("communication_contacts")
        .selectAll()
        .where("bot_identity", "=", start.botIdentity)
        .where("telegram_user_id", "=", start.telegramUserId)
        .executeTakeFirstOrThrow();
      const sourceRow = hasText(source)
        ? await tx
            .selectFrom("communication_sources")
            .selectAll()
            .where("bot_identity", "=", start.botIdentity)
            .where("code", "=", source)
            .executeTakeFirst()
        : undefined;
      let query = tx
        .selectFrom("communication_sequences")
        .selectAll()
        .where("bot_identity", "=", start.botIdentity)
        .where("lifecycle", "=", "published");
      query = hasText(source)
        ? query.where(
            "sequence_id",
            "=",
            sourceRow?.sequence_id ?? "00000000-0000-0000-0000-000000000000",
          )
        : query.where("is_default", "=", true);
      const row = await query.executeTakeFirst();
      const sequence =
        row?.published &&
        row.published_revision !== null &&
        (!hasText(source) ||
          row.published.sources.some((s) => s.code === source))
          ? {
              sequenceId: row.sequence_id,
              draft: decodeStoredSequenceDraft(row.published),
              revision: row.published_revision,
            }
          : undefined;
      const now = this.clock.now();
      await tx
        .insertInto("communication_entries")
        .values({
          bot_identity: start.botIdentity,
          update_id: start.updateId,
          contact_id: contact.contact_id,
          sequence_id: sequence?.sequenceId ?? null,
          source_id: sourceRow?.source_id ?? null,
          source_code: source ?? null,
          entered_at: now,
          outcome: !contact.marketing_enabled
            ? "marketing_off"
            : sequence
              ? "entered"
              : "unavailable",
        })
        .execute();
      await recordBotEntered(tx, {
        botIdentity: start.botIdentity,
        updateId: start.updateId,
        contactRef: contact.contact_id,
        enteredAt: now,
        source,
      });
      const common = {
        bot: start.botIdentity,
        contactId: contact.contact_id,
        now,
        dueAt: now,
      };
      if (!sequence) {
        await planDelivery(tx, {
          ...common,
          kind: "fallback",
          key: `fallback:${start.botIdentity}:${start.updateId}`,
          revision: 0,
          parts: [
            {
              partId: randomUUID(),
              content: {
                type: "text",
                text: "Эта ссылка сейчас недоступна. Общее знакомство — /start.",
                entities: [],
                buttons: [],
              },
            },
          ],
        });
        return;
      }
      const intro = await tx
        .selectFrom("communication_intro")
        .select("snapshot")
        .where("bot_identity", "=", start.botIdentity)
        .executeTakeFirstOrThrow();
      const introSnapshot = intro.snapshot;
      await planDelivery(tx, {
        ...common,
        kind: "intro",
        key: `intro:${contact.contact_id}`,
        parts: introSnapshot.parts,
        revision: introSnapshot.revision,
      });
      if (!contact.marketing_enabled) {
        const intro = await tx
          .selectFrom("communication_deliveries")
          .selectAll()
          .where("dedup_key", "=", `intro:${contact.contact_id}`)
          .executeTakeFirstOrThrow();
        await cancelDelivery(tx, intro, now, "marketing_unavailable");
      }
      await tx
        .insertInto("communication_participations")
        .values({
          participation_id: randomUUID(),
          contact_id: contact.contact_id,
          sequence_id: sequence.sequenceId,
          participated_at: now,
          initial_entry_key: `entry:${start.botIdentity}:${start.updateId}`,
        })
        .onConflict((c) => c.columns(["contact_id", "sequence_id"]).doNothing())
        .execute();
      await planDelivery(tx, {
        ...common,
        kind: "entry",
        key: `entry:${start.botIdentity}:${start.updateId}`,
        sequenceId: sequence.sequenceId,
        stepId: sequence.draft.entryResponse.stepId,
        parts: sequence.draft.entryResponse.parts,
        revision: sequence.revision,
      });
    });
  }
}
