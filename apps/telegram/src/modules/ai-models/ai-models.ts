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
import type { AiModelsOpening, AiModelsQuery } from "./ai-models-requests.js";
import type { AiModelsOpeningDelivery } from "./ai-models-storage.js";
import { AI_MODELS_WIDGET_HTML } from "./widget/ai-models-widget-html.generated.js";
import {
  AI_MODELS_FIRST_PAGE,
  encodeAiModelsWidgetData,
  type AiModelsWidgetData,
} from "./widget/ai-models-widget-wire.js";

const NO_REFERENCE_TEXT = "Раздел «ИИ-модели» скоро откроется.";
const WIDGET_REJECTED_TEXT =
  "Раздел «ИИ-модели» не открылся. Обновите Telegram до последней версии и отправьте /models ещё раз.";
/** The Trainer's wording, so both widgets refuse a press over the limit alike. */
const TOO_OFTEN_TEXT = "Слишком часто. Повторите через несколько секунд.";
/** Every request gets this answer until the screens of the section exist. */
const COMING_SOON_TEXT = "Скоро здесь будет список моделей";

/**
 * The ИИ-модели section of the private chat. It acts only inside a person's own request: `open`
 * sends the widget message and `answer` answers a press inside it. Nothing here runs on a
 * schedule.
 */
@Injectable()
export class AiModels {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(TELEGRAM_MESSAGES)
    private readonly messages: Pick<
      TelegramMessages,
      "sendWidget" | "answerWidgetQuery"
    >,
  ) {}

  /**
   * Records the opening and sends one widget message. One request never yields a second
   * widget: a repeated run of the same update sends again only after Telegram refused the
   * earlier send for now. Without a Справочник one text says the section opens soon; if
   * Telegram rejects the widget, one text asks the person to update Telegram.
   */
  async open(opening: AiModelsOpening): Promise<void> {
    const { contact } = opening;
    if (!(await this.referenceLoaded())) return this.answerNoReference(opening);
    if (!(await this.claim(opening))) return;

    const result = await this.messages.sendWidget({
      chatId: contact.privateChatId,
      html: AI_MODELS_WIDGET_HTML,
      chatData: encodeAiModelsWidgetData(AI_MODELS_FIRST_PAGE),
      height: 0,
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
            ...replyTo(contact),
            messageText: WIDGET_REJECTED_TEXT,
            sourceKey: `ai-models-rejected:${contact.botIdentity}:${contact.updateId}`,
          });
        });
      case "api_retryable":
        await this.settle(this.database, contact, "retry");
        // The inbox runs the update again after its backoff.
        throw new Error(
          `Telegram refused the ИИ-модели widget for now (${String(result.providerErrorCode)})`,
        );
      default:
        return unhandled(result, "Telegram delivery result");
    }
  }

  /** Answers a press inside the widget; it never sends a message. */
  async answer(query: AiModelsQuery): Promise<void> {
    await this.reply(query.queryId, ["x", COMING_SOON_TEXT]);
  }

  /** The answer to a press over the per-user request limit. */
  async refuse(queryId: string): Promise<void> {
    await this.reply(queryId, ["x", TOO_OFTEN_TEXT]);
  }

  private reply(queryId: string, data: AiModelsWidgetData): Promise<void> {
    return this.messages.answerWidgetQuery({
      queryId,
      data: encodeAiModelsWidgetData(data),
    });
  }

  private async referenceLoaded(): Promise<boolean> {
    const reference = await this.database
      .selectFrom("ai_models_references")
      .select("revision")
      .limit(1)
      .executeTakeFirst();
    return reference !== undefined;
  }

  /** The opening and its one text commit together; a repeated update adds neither. */
  private answerNoReference(opening: AiModelsOpening): Promise<void> {
    const { contact } = opening;
    return this.database.transaction().execute(async (transaction) => {
      if (!(await this.record(transaction, opening, "no_reference"))) return;
      await enqueueReply(transaction, {
        ...replyTo(contact),
        messageText: NO_REFERENCE_TEXT,
        sourceKey: `ai-models-no-reference:${contact.botIdentity}:${contact.updateId}`,
      });
    });
  }

  /** True when this run of the update is the one that sends the widget. */
  private async claim(opening: AiModelsOpening): Promise<boolean> {
    const { contact } = opening;
    if (await this.record(this.database, opening, "sending")) return true;
    const retried = await this.database
      .updateTable("ai_models_openings")
      .set({ delivery: "sending" })
      .where("bot_identity", "=", contact.botIdentity)
      .where("update_id", "=", contact.updateId)
      .where("delivery", "=", "retry")
      .returning("opening_id")
      .executeTakeFirst();
    return retried !== undefined;
  }

  /** Writes the opening of this update; false when an earlier run already wrote it. */
  private async record(
    database: Pick<Database, "insertInto">,
    opening: AiModelsOpening,
    delivery: AiModelsOpeningDelivery,
  ): Promise<boolean> {
    const { contact } = opening;
    const recorded = await database
      .insertInto("ai_models_openings")
      .values({
        opening_id: randomUUID(),
        bot_identity: contact.botIdentity,
        update_id: contact.updateId,
        telegram_user_id: contact.telegramUserId,
        entry: opening.entry,
        source_code: opening.source ?? null,
        opened_at: contact.observedAt,
        delivery,
        provider_message_id: null,
      })
      .onConflict((conflict) =>
        conflict.columns(["bot_identity", "update_id"]).doNothing(),
      )
      .returning("opening_id")
      .executeTakeFirst();
    return recorded !== undefined;
  }

  private async settle(
    database: Pick<Database, "updateTable">,
    contact: VerifiedPrivateStart,
    delivery: AiModelsOpeningDelivery,
    providerMessageId?: string,
  ): Promise<void> {
    await database
      .updateTable("ai_models_openings")
      .set({ delivery, provider_message_id: providerMessageId ?? null })
      .where("bot_identity", "=", contact.botIdentity)
      .where("update_id", "=", contact.updateId)
      .execute();
  }
}

/** The private chat of the person whose update the reply answers. */
function replyTo(contact: VerifiedPrivateStart) {
  return {
    botIdentity: contact.botIdentity,
    telegramUserId: contact.telegramUserId,
    privateChatId: contact.privateChatId,
    triggerUpdateId: contact.updateId,
    now: contact.observedAt,
  };
}
