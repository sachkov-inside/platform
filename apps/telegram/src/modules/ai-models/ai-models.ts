import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type Database } from "../../database/database.js";
import { CLOCK, type Clock } from "../../shared/clock.js";
import type { VerifiedPrivateStart } from "../../shared/telegram-contact.js";
import { unhandled } from "../../shared/unhandled.js";
import { enqueueReply } from "../outbound/start-response-delivery-queue.js";
import {
  TELEGRAM_MESSAGES,
  type TelegramMessages,
} from "../outbound/telegram-messages.js";
import {
  AiModelsReferences,
  type StoredAiModelsReference,
} from "./ai-models-reference.js";
import type { AiModelsOpening, AiModelsQuery } from "./ai-models-requests.js";
import type { AiModelsOpeningDelivery } from "./ai-models-storage.js";
import { AI_MODELS_WIDGET_HTML } from "./widget/ai-models-widget-html.generated.js";
import {
  aiModelsChatData,
  aiModelsResponse,
  encodeAiModelsWidgetData,
  parseAiModelsWidgetRequest,
  type AiModelsWidgetData,
} from "./widget/ai-models-widget-wire.js";

const NO_REFERENCE_TEXT = "Раздел «ИИ-модели» скоро откроется.";
const WIDGET_REJECTED_TEXT =
  "Раздел «ИИ-модели» не открылся. Обновите Telegram до последней версии и отправьте /models ещё раз.";
/** The Trainer's wording, so both widgets refuse a press over the limit alike. */
const TOO_OFTEN_TEXT = "Слишком часто. Повторите через несколько секунд.";
/**
 * A request for a page or a model the current Справочник does not have: the message was sent
 * with an earlier Справочник, and a new widget shows the new one.
 */
const STALE_TEXT =
  "Список моделей обновился. Отправьте /models, чтобы открыть новый.";

/**
 * The ИИ-модели section of the private chat. It acts only inside a person's own request: `open`
 * sends the widget message and `answer` answers a press inside it. Nothing here runs on a
 * schedule.
 */
@Injectable()
export class AiModels {
  private readonly references: AiModelsReferences;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(TELEGRAM_MESSAGES)
    private readonly messages: Pick<
      TelegramMessages,
      "sendWidget" | "answerWidgetQuery"
    >,
    @Inject(CLOCK) clock: Clock,
  ) {
    this.references = new AiModelsReferences(database, clock);
  }

  /**
   * Records the opening and sends one widget message with the first page of «Мощные» as its
   * chat state. One request never yields a second widget: a repeated run of the same update
   * sends again only after Telegram refused the earlier send for now. Without a Справочник one
   * text says the section opens soon; if Telegram rejects the widget, one text asks the person
   * to update Telegram.
   */
  async open(opening: AiModelsOpening): Promise<void> {
    const { contact } = opening;
    const stored = await this.references.current();
    if (!stored) return this.answerNoReference(opening);
    if (!(await this.claim(opening))) return;

    const result = await this.messages.sendWidget({
      chatId: contact.privateChatId,
      html: AI_MODELS_WIDGET_HTML,
      chatData: encodeAiModelsWidgetData(aiModelsChatData(stored.reference)),
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

  /**
   * Answers a press inside the widget with a screen of the current Справочник; it never sends a
   * message. Every answered tab «Главное» is recorded as an opened card.
   */
  async answer(query: AiModelsQuery): Promise<void> {
    const request = parseAiModelsWidgetRequest(query.data);
    if (!request) return this.reply(query.queryId, ["x"]);
    const stored = await this.references.current();
    const screen = stored && aiModelsResponse(stored.reference, request);
    if (screen?.[0] === "m") await this.recordCardView(query, screen[1]);
    await this.reply(query.queryId, screen ?? failure(stored));
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

  private async recordCardView(
    { contact }: AiModelsQuery,
    model: string,
  ): Promise<void> {
    await this.database
      .insertInto("ai_models_card_views")
      .values({
        bot_identity: contact.botIdentity,
        telegram_user_id: contact.telegramUserId,
        model_code: model,
        viewed_at: contact.observedAt,
      })
      .execute();
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

/** The answer to a request the current Справочник cannot answer, or to any before the first import. */
function failure(
  stored: StoredAiModelsReference | undefined,
): AiModelsWidgetData {
  return ["x", stored ? STALE_TEXT : NO_REFERENCE_TEXT];
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
