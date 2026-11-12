import type { ColumnType, Generated } from "kysely";

import type { AiModelsEntry } from "./ai-models-requests.js";

type Timestamp = ColumnType<Date, Date, Date>;
type TelegramId = ColumnType<
  string,
  bigint | number | string,
  bigint | number | string
>;
/** jsonb written as JSON text; pg parses it back on read. */
type JsonObject = ColumnType<Record<string, unknown>, string, string>;

/**
 * The fate of the widget message of one opening. `sending` is written before the call to
 * Telegram and stays when the process stopped in the middle; `retry` marks a send Telegram
 * refused for now, so the same request may send again; `no_reference` means no Справочник was
 * loaded, so the bot answered with a text and sent no widget.
 */
export type AiModelsOpeningDelivery =
  "sending" | "retry" | "delivered" | "rejected" | "unknown" | "no_reference";

export interface AiModelsTables {
  /** One row per request to open ИИ-модели. */
  ai_models_openings: {
    opening_id: string;
    bot_identity: string;
    update_id: TelegramId;
    telegram_user_id: TelegramId;
    entry: AiModelsEntry;
    /** The label of the section link; null when the person came without one. */
    source_code: string | null;
    opened_at: Timestamp;
    delivery: AiModelsOpeningDelivery;
    provider_message_id: TelegramId | null;
  };
  /**
   * Every Справочник the owner imported, kept as history. The highest revision is the one people
   * see. The author's opinion is stored apart from the facts it is shown with.
   */
  ai_models_references: {
    revision: number;
    /** The date the facts were last checked, written as `YYYY-MM-DD`. */
    checked_on: ColumnType<Date, string, string>;
    facts: JsonObject;
    author: JsonObject;
    /** SHA-256 of the imported file, in lowercase hex. */
    content_sha256: string;
    imported_at: Timestamp;
  };
  /** One row per opened tab «Главное» of a model card; it belongs to a BotContact. */
  ai_models_card_views: {
    id: Generated<string>;
    bot_identity: string;
    telegram_user_id: TelegramId;
    model_code: string;
    viewed_at: Timestamp;
  };
}
