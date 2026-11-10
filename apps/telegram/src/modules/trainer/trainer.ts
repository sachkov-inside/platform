import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type Database } from "../../database/database.js";
import type { VerifiedPrivateStart } from "../../shared/telegram-contact.js";
import { unhandled } from "../../shared/unhandled.js";
import { enqueueReply } from "../outbound/start-response-delivery-queue.js";
import {
  TELEGRAM_MESSAGES,
  type TelegramMessages,
} from "../outbound/telegram-messages.js";
import type { TrainerOpening, TrainerQuery } from "./trainer-requests.js";
import type { TrainerOpeningDelivery } from "./trainer-storage.js";
import { TRAINER_WIDGET_HTML } from "./widget/trainer-widget-html.generated.js";
import {
  encodeTrainerWidgetData,
  parseTrainerWidgetRequest,
  type TrainerHomeData,
  type TrainerWidgetData,
  type TrainerWidgetRequest,
} from "./widget/trainer-widget-wire.js";

/** Answered questions that complete the Daily goal. */
const TRAINER_DAILY_GOAL = 5;

// The caption keeps the message time off the widget, is the text of the chat list and the
// notification, and is all a Telegram app without widgets shows (ADR 0004).
const WIDGET_CAPTION =
  "Тренажёр Inside. Если вместо него пустое сообщение, обновите Telegram.";
const WIDGET_REJECTED_TEXT =
  "Тренажёр не открылся. Обновите Telegram до последней версии и отправьте /train ещё раз.";
const SECTION_NOT_OPEN_TEXT = "Этот раздел скоро откроется.";
const TOO_OFTEN_TEXT = "Слишком часто. Повторите через несколько секунд.";

/**
 * The Trainer of the private chat. It acts only inside a person's own request: `open` sends
 * the widget message and `answer` answers a press inside it. Nothing here runs on a schedule.
 */
@Injectable()
export class Trainer {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(TELEGRAM_MESSAGES)
    private readonly messages: Pick<
      TelegramMessages,
      "sendWidget" | "answerWidgetQuery"
    >,
  ) {}

  /**
   * Records the opening and sends one widget message with the home screen. One request never
   * yields a second widget: a repeated run of the same update sends again only after Telegram
   * refused the earlier send for now. If Telegram rejects the widget, one text asks the person
   * to update Telegram.
   */
  async open(opening: TrainerOpening): Promise<void> {
    const { contact } = opening;
    if (!(await this.claim(opening))) return;

    const result = await this.messages.sendWidget({
      chatId: contact.privateChatId,
      html: TRAINER_WIDGET_HTML,
      chatData: encodeTrainerWidgetData(await this.home(contact)),
      caption: WIDGET_CAPTION,
    });
    switch (result.kind) {
      case "delivered":
        return this.settle(
          this.database,
          contact,
          "delivered",
          result.providerMessageId,
        );
      case "transport_unknown":
        // The widget may have arrived, so nothing more is sent; the person asks again if not.
        return this.settle(this.database, contact, "unknown");
      case "api_rejected":
        return this.database.transaction().execute(async (transaction) => {
          await this.settle(transaction, contact, "rejected");
          await enqueueReply(transaction, {
            botIdentity: contact.botIdentity,
            telegramUserId: contact.telegramUserId,
            privateChatId: contact.privateChatId,
            messageText: WIDGET_REJECTED_TEXT,
            sourceKey: `trainer-rejected:${contact.botIdentity}:${contact.updateId}`,
            triggerUpdateId: contact.updateId,
            now: contact.observedAt,
          });
        });
      case "api_retryable":
        await this.settle(this.database, contact, "retry");
        // The inbox runs the update again after its backoff.
        throw new Error(
          `Telegram refused the Trainer widget for now (${String(result.providerErrorCode)})`,
        );
      default:
        return unhandled(result, "Telegram delivery result");
    }
  }

  /** Answers a press inside the widget with the next screen; it never sends a message. */
  async answer(query: TrainerQuery): Promise<void> {
    const request = parseTrainerWidgetRequest(query.data);
    await this.reply(
      query.queryId,
      request ? await this.respond(query.contact, request) : ["x"],
    );
  }

  /** The answer to a press over the per-user request limit. */
  async refuse(queryId: string): Promise<void> {
    await this.reply(queryId, ["x", TOO_OFTEN_TEXT]);
  }

  /**
   * The screen a request leads to. The request is parsed but still untrusted: each mode checks
   * it against the bot's own state before it answers.
   */
  private async respond(
    contact: VerifiedPrivateStart,
    request: TrainerWidgetRequest,
  ): Promise<TrainerWidgetData> {
    switch (request.kind) {
      case "home":
        return this.home(contact);
      case "start_check":
      case "start_daily":
      case "topics":
      case "start_topic":
      case "progress":
      case "rating":
      case "set_rating_shown":
      case "next":
      case "answer":
        return ["x", SECTION_NOT_OPEN_TEXT];
      default:
        return unhandled(request, "Trainer widget request");
    }
  }

  /** Home-screen numbers of this person: nobody has answered a question yet. */
  private home(_contact: VerifiedPrivateStart): Promise<TrainerHomeData> {
    return Promise.resolve(["h", 0, 0, TRAINER_DAILY_GOAL, 0]);
  }

  private reply(queryId: string, data: TrainerWidgetData): Promise<void> {
    return this.messages.answerWidgetQuery({
      queryId,
      data: encodeTrainerWidgetData(data),
    });
  }

  /** True when this run of the update is the one that sends the widget. */
  private async claim(opening: TrainerOpening): Promise<boolean> {
    const { contact } = opening;
    const recorded = await this.database
      .insertInto("trainer_openings")
      .values({
        opening_id: randomUUID(),
        bot_identity: contact.botIdentity,
        update_id: contact.updateId,
        telegram_user_id: contact.telegramUserId,
        entry: opening.entry,
        source_code: opening.source ?? null,
        opened_at: contact.observedAt,
        delivery: "sending",
        provider_message_id: null,
      })
      .onConflict((conflict) =>
        conflict.columns(["bot_identity", "update_id"]).doNothing(),
      )
      .returning("opening_id")
      .executeTakeFirst();
    if (recorded) return true;
    const retried = await this.database
      .updateTable("trainer_openings")
      .set({ delivery: "sending" })
      .where("bot_identity", "=", contact.botIdentity)
      .where("update_id", "=", contact.updateId)
      .where("delivery", "=", "retry")
      .returning("opening_id")
      .executeTakeFirst();
    return retried !== undefined;
  }

  private async settle(
    database: Pick<Database, "updateTable">,
    contact: VerifiedPrivateStart,
    delivery: TrainerOpeningDelivery,
    providerMessageId?: string,
  ): Promise<void> {
    await database
      .updateTable("trainer_openings")
      .set({ delivery, provider_message_id: providerMessageId ?? null })
      .where("bot_identity", "=", contact.botIdentity)
      .where("update_id", "=", contact.updateId)
      .execute();
  }
}
