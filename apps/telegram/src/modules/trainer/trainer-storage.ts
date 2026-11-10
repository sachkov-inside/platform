import type { ColumnType } from "kysely";

import type { TrainerEntry } from "./trainer-requests.js";

type Timestamp = ColumnType<Date, Date, Date>;
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
