import { sql } from "kysely";
import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../database/database.js";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { CommunityAuthors } from "../communications/community-authors.js";
import type {
  CommunityMessage,
  CommunityMessageInput,
} from "./community-message.js";

@Injectable()
export class CommunityMessages {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
    @Inject(CommunityAuthors) private readonly authors: CommunityAuthors,
  ) {}

  async capture(input: CommunityMessageInput): Promise<void> {
    const policy = this.config.communityDiscussions;
    if (
      !policy ||
      input.botIdentity !== this.config.botIdentity ||
      input.chatId !== this.config.canonicalChatId
    )
      return;
    if (
      policy.topicIds !== undefined &&
      (input.threadId === null ||
        !policy.topicIds.includes(Number(input.threadId)))
    )
      return;
    await this.database
      .insertInto("community_messages")
      .values({
        bot_identity: input.botIdentity,
        chat_id: input.chatId,
        message_id: input.messageId,
        thread_id: input.threadId,
        reply_to_message_id: input.replyToMessageId,
        sent_at: input.sentAt,
        edited_at: input.editedAt,
        sender_telegram_user_id: input.senderTelegramUserId,
        is_author: null,
        kind: input.kind,
        text: input.text,
        file_id: input.fileId,
        last_update_id: input.updateId,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["bot_identity", "chat_id", "message_id"])
          .doUpdateSet({
            text: input.text,
            kind: input.kind,
            file_id: input.fileId,
            edited_at: input.editedAt,
            last_update_id: input.updateId,
          })
          .where(
            sql<boolean>`excluded.last_update_id > community_messages.last_update_id`,
          ),
      )
      .execute();
  }

  /** Traverse every continuation; unavailable roles remain null for the next run. Capture never calls Platform. */
  async resolveAuthors(input: {
    readonly limit: number;
    readonly after?: string;
  }): Promise<{
    readonly resolved: number;
    readonly nextAfter: string | null;
  }> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 1000
    )
      throw new Error(
        "Community message page limit must be between 1 and 1000",
      );
    let query = this.database
      .selectFrom("community_messages")
      .select(["message_id", "sender_telegram_user_id"])
      .where("bot_identity", "=", this.config.botIdentity)
      .where("chat_id", "=", this.config.canonicalChatId)
      .where("is_author", "is", null);
    if (input.after !== undefined)
      query = query.where("message_id", ">", input.after);
    const rows = await query
      .orderBy("message_id")
      .limit(input.limit + 1)
      .execute();
    const page = rows.slice(0, input.limit);
    const roles = await this.authors.rolesFor(this.config.botIdentity, [
      ...new Set(page.map((row) => row.sender_telegram_user_id)),
    ]);
    let resolved = 0;
    for (const row of page) {
      const isAuthor = roles.get(row.sender_telegram_user_id);
      if (isAuthor === null || isAuthor === undefined) continue;
      const result = await this.database
        .updateTable("community_messages")
        .set({ is_author: isAuthor })
        .where("bot_identity", "=", this.config.botIdentity)
        .where("chat_id", "=", this.config.canonicalChatId)
        .where("message_id", "=", row.message_id)
        .where("is_author", "is", null)
        .executeTakeFirst();
      resolved += Number(result.numUpdatedRows);
    }
    return {
      resolved,
      nextAfter:
        rows.length > input.limit ? (page.at(-1)?.message_id ?? null) : null,
    };
  }

  /** One bounded page in Telegram message order. The cursor belongs to the configured group. */
  async readMessages(input: {
    readonly limit: number;
    readonly after?: string;
  }): Promise<{
    readonly messages: readonly CommunityMessage[];
    readonly nextAfter: string | null;
  }> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 1000
    )
      throw new Error(
        "Community message page limit must be between 1 and 1000",
      );
    let query = this.database
      .selectFrom("community_messages")
      .selectAll()
      .where("bot_identity", "=", this.config.botIdentity)
      .where("chat_id", "=", this.config.canonicalChatId);
    if (input.after !== undefined)
      query = query.where("message_id", ">", input.after);
    const rows = await query
      .orderBy("message_id")
      .limit(input.limit + 1)
      .execute();
    const page = rows.slice(0, input.limit);
    return {
      messages: page.map((row) => ({
        botIdentity: row.bot_identity,
        chatId: row.chat_id,
        messageId: row.message_id,
        threadId: row.thread_id,
        replyToMessageId: row.reply_to_message_id,
        sentAt: row.sent_at,
        editedAt: row.edited_at,
        senderTelegramUserId: row.sender_telegram_user_id,
        isAuthor: row.is_author,
        kind: row.kind,
        text: row.text,
        fileId: row.file_id,
      })),
      nextAfter:
        rows.length > input.limit ? (page.at(-1)?.message_id ?? null) : null,
    };
  }
}
