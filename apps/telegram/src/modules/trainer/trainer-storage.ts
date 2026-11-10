import type { ColumnType } from "kysely";

import type {
  TrainerBankOption,
  TrainerBankQuestion,
} from "./trainer-bank-file.js";
import type { TrainerEntry } from "./trainer-requests.js";

type Timestamp = ColumnType<Date, Date, Date>;
type OptionalTimestamp = ColumnType<
  Date | null,
  Date | null | undefined,
  Date | null
>;
type TelegramId = ColumnType<
  string,
  bigint | number | string,
  bigint | number | string
>;

/**
 * The fate of the widget message of one opening. `sending` is written before the call to
 * Telegram and stays when the process stopped in the middle; `retry` marks a send Telegram
 * refused for now, so the same request may send again.
 */
export type TrainerOpeningDelivery =
  "sending" | "retry" | "delivered" | "rejected" | "unknown";

export interface TrainerTables {
  /** Topics of the Bank. `position` is the order of the Bank file. */
  trainer_topics: {
    code: string;
    name: string;
    position: number;
    /** Set when an import no longer lists the topic. */
    withdrawn_at: OptionalTimestamp;
    updated_at: Timestamp;
  };
  /** Questions of the Bank. `id` is the author's identifier and survives every import. */
  trainer_questions: {
    id: string;
    topic_code: string;
    format: TrainerBankQuestion["format"];
    text: string;
    /** jsonb written as JSON text; option order is the order of the Bank file. */
    options: ColumnType<TrainerBankOption[], string, string>;
    explanation: string;
    /** For the author only; never sent to the widget. */
    source: string;
    /** For the author only; never sent to the widget. */
    checked_on: ColumnType<Date, string, string>;
    /** Grows by one with every import that changes the stored question. */
    content_revision: ColumnType<number, number | undefined, number>;
    added_at: Timestamp;
    updated_at: Timestamp;
    /** Set when an import no longer has the question: it is not shown, its history stays. */
    withdrawn_at: OptionalTimestamp;
  };
  /** One row per request to open the Trainer. */
  trainer_openings: {
    opening_id: string;
    bot_identity: string;
    update_id: TelegramId;
    telegram_user_id: TelegramId;
    entry: TrainerEntry;
    /** The label of the Trainer link; null when the person came without one. */
    source_code: string | null;
    opened_at: Timestamp;
    delivery: TrainerOpeningDelivery;
    provider_message_id: TelegramId | null;
  };
}
