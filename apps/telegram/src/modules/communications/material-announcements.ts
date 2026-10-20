import { externalRead } from "../../database/external-reads.js";
import type { Transaction } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { MaterialAnnouncement } from "@inside/contracts/material-announcements";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import { DATABASE, type Database } from "../../database/database.js";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { CLOCK, type Clock } from "../../shared/clock.js";
import { botContactRows } from "../bot-contacts/contact-access.js";
import { schedulerLock, planDeliveries } from "./communication-state.js";
import {
  MATERIAL_ANNOUNCEMENT_SOURCE,
  type MaterialAnnouncementSource,
} from "./material-announcement-source.js";
import type { TemplateContent } from "./communications-contract.js";

/** UTF-16 offsets are Telegram entity offsets; all author text remains plain text. */
export function materialAnnouncementContent(
  item: MaterialAnnouncement,
): TemplateContent {
  const prefix = "Новый открытый материал\n\n";
  return {
    type: "text",
    text: `${prefix}${item.title}\n\n${item.summary}\n\n${item.url}`,
    entities: [
      { type: "bold", offset: prefix.length, length: item.title.length },
    ],
    buttons: [{ text: "Открыть материал", url: item.url }],
  };
}

const MATERIAL_ANNOUNCEMENT_POLL_MS = 30_000;

@Injectable()
export class MaterialAnnouncements {
  private after: string | undefined;
  private nextPollAt = 0;
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(MATERIAL_ANNOUNCEMENT_SOURCE)
    private readonly source: MaterialAnnouncementSource,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  audienceKey(): string | undefined {
    const config = this.config.materialAnnouncements;
    return config === undefined
      ? undefined
      : config.mode === "all"
        ? "all"
        : `test:${config.telegramUserId}`;
  }
  async plan(): Promise<void> {
    const audienceKey = this.audienceKey();
    const now = this.clock.now();
    if (audienceKey === undefined || this.nextPollAt > +now) return;
    // One bounded page per cycle. Exhaustion starts a fresh traversal after the poll interval.
    const page = await this.source.read(
      this.after === undefined ? {} : { after: this.after },
    );
    if (page === null) {
      this.nextPollAt = +now + MATERIAL_ANNOUNCEMENT_POLL_MS;
      return;
    }
    for (const item of page.items) await this.stage(item, audienceKey, now);
    this.after = page.nextCursor ?? undefined;
    this.nextPollAt =
      page.nextCursor === null ? +now + MATERIAL_ANNOUNCEMENT_POLL_MS : 0;
  }
  async current(
    broadcastId: string,
    executor: Database | Transaction<DatabaseSchema> = this.database,
  ): Promise<"current" | "withdrawn" | "unavailable" | "unmanaged"> {
    const receipt = await executor
      .selectFrom("communication_material_announcements")
      .selectAll()
      .where("broadcast_id", "=", broadcastId)
      .where("bot_identity", "=", this.config.botIdentity)
      .executeTakeFirst();
    if (!receipt) return "unmanaged";
    if (
      receipt.audience_key !== this.audienceKey() ||
      Date.parse(receipt.snapshot.notAfter) <= +this.clock.now()
    )
      return "withdrawn";
    const result = await externalRead(
      `material-announcement:${broadcastId}`,
      () => this.source.read({ announcementRef: receipt.announcement_ref }),
    );
    if (result === null) return "unavailable";
    // A changed promise is cancelled, never silently resent as a new announcement.
    return result.items.some((item) =>
      isDeepStrictEqual(item, receipt.snapshot),
    )
      ? "current"
      : "withdrawn";
  }
  private async stage(
    item: MaterialAnnouncement,
    audienceKey: string,
    now: Date,
  ) {
    if (Date.parse(item.notAfter) <= +now) return;
    const bot = this.config.botIdentity;
    await this.database.transaction().execute(async (tx) => {
      await schedulerLock(tx, bot);
      const prior = await tx
        .selectFrom("communication_material_announcements")
        .select("broadcast_id")
        .where("bot_identity", "=", bot)
        .where("announcement_ref", "=", item.announcementRef)
        .where("audience_key", "=", audienceKey)
        .executeTakeFirst();
      if (prior) return;
      await sql`insert into communication_contacts(contact_id,bot_identity,telegram_user_id)
        select gen_random_uuid(),bot_identity,telegram_user_id from (${botContactRows(tx)}) b where bot_identity=${bot}
        on conflict(bot_identity,telegram_user_id) do nothing`.execute(tx);
      let query = tx
        .selectFrom("communication_contacts as c")
        .innerJoin(botContactRows(tx).as("b"), (join) =>
          join
            .onRef("b.bot_identity", "=", "c.bot_identity")
            .onRef("b.telegram_user_id", "=", "c.telegram_user_id"),
        )
        .select("c.contact_id")
        .where("c.bot_identity", "=", bot)
        .where("c.marketing_enabled", "=", true)
        .where("c.unavailable_since", "is", null)
        .where("b.contactability", "=", "reachable")
        .where("b.first_started_at", "<=", new Date(item.occurredAt))
        .forShare("c");
      const config = this.config.materialAnnouncements;
      if (config?.mode === "test")
        query = query.where("c.telegram_user_id", "=", config.telegramUserId);
      const contacts = await query.execute();
      const broadcastId = randomUUID();
      const parts = [
        { partId: randomUUID(), content: materialAnnouncementContent(item) },
      ];
      await tx
        .insertInto("communication_broadcasts")
        .values({
          broadcast_id: broadcastId,
          bot_identity: bot,
          owner_account_ref: "platform-material-announcements",
          revision: 1,
          state: contacts.length > 0 ? "running" : "completed",
          parts: JSON.stringify(parts),
          audience: JSON.stringify({ kind: "all" }),
          scheduled_at: null,
          audience_snapshot_id: randomUUID(),
          snapshot_size: contacts.length,
          launched_at: now,
          launch_operation_id: null,
          created_at: now,
        })
        .execute();
      await tx
        .insertInto("communication_material_announcements")
        .values({
          bot_identity: bot,
          announcement_ref: item.announcementRef,
          audience_key: audienceKey,
          broadcast_id: broadcastId,
          snapshot: JSON.stringify(item),
        })
        .execute();
      await planDeliveries(
        tx,
        contacts.map((contact) => ({
          bot,
          contactId: contact.contact_id,
          broadcastId,
          kind: "broadcast",
          key: `broadcast:${broadcastId}:${contact.contact_id}`,
          parts,
          revision: 1,
          dueAt: now,
          now,
        })),
      );
    });
  }
}
