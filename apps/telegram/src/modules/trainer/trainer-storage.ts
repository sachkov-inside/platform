import type { ColumnType, Generated } from "kysely";

import type {
  TrainerBankOption,
  TrainerBankQuestion,
} from "./trainer-bank-file.js";
import type { TrainerEntry } from "./trainer-requests.js";
import type { TrainerReaction } from "./widget/trainer-widget-wire.js";

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

/**
 * `check` is «Проверить себя», `topic` is Тренировка по теме, `daily` is Вопрос дня (a round
 * of one question).
 */
export type TrainerRoundMode = "check" | "topic" | "daily";

export interface TrainerTables {
  /** Immutable text and options of each stored Bank revision. */
  trainer_question_versions: {
    question_id: string;
    content_revision: number;
    text: string;
    options: ColumnType<TrainerBankOption[], string, never>;
    explanation: string;
  };
  trainer_question_reactions: {
    bot_identity: string;
    telegram_user_id: TelegramId;
    question_id: string;
    /** 0 cleared (kept to reject delayed writes), 1 like, 2 dislike. */
    reaction: TrainerReaction;
    observed_at: Timestamp;
  };
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
  /** One row per started round of any mode; it belongs to a BotContact. */
  trainer_rounds: {
    id: Generated<string>;
    bot_identity: string;
    telegram_user_id: TelegramId;
    mode: TrainerRoundMode;
    /** The chosen topic of a `topic` round; null in the other modes. */
    topic_code: string | null;
    /** Steps in the round; fewer than the mode asks for when the Bank had fewer to give. */
    size: number;
    /** When the bot received the request that started the round. */
    started_at: Timestamp;
    /** Statistical credit is given only after the round is completed. */
    completed_at: OptionalTimestamp;
    /** The Telegram update that started the round: a repeated run finds the same round. */
    update_id: TelegramId;
    /** The Moscow day of a `daily` round, written as `YYYY-MM-DD`; null in the other modes. */
    daily_day: ColumnType<
      Date | null,
      string | null | undefined,
      string | null
    >;
  };
  /** The Daily question of each Moscow day, chosen by the first request of that day. */
  trainer_daily_questions: {
    bot_identity: string;
    /** The Moscow day, written as `YYYY-MM-DD`. */
    day: ColumnType<Date, string, string>;
    question_id: string;
    /** The pass over the Bank the choice belongs to: no question repeats within a cycle. */
    cycle: number;
    /** When the bot received the first request of the day. */
    chosen_at: Timestamp;
  };
  /**
   * One row per step of a round, written when the round starts. A step is issued when the
   * person is shown its question and answered when the person answers; both happen once.
   */
  trainer_issues: {
    /** The widget names the issue by this number in base 36. */
    id: Generated<string>;
    round_id: string;
    /** 1 for the first step of the round. */
    position: number;
    bot_identity: string;
    telegram_user_id: TelegramId;
    question_id: string;
    /** Frozen at first display; steps not yet displayed follow Bank updates. */
    content_revision: number;
    /** Number of options at first display; an answer is judged against them. */
    option_count: number;
    /** Bit `i` is set when option `i` was correct at first display. */
    correct_mask: number;
    /** When the bot received the request that showed the question; null: not shown yet. */
    issued_at: OptionalTimestamp;
    /** When the bot received the answer; null: not answered. */
    answered_at: OptionalTimestamp;
    /** The picked options; 0 is «Не знаю». */
    picked_mask: number | null;
    correct: boolean | null;
    /** True when this is the person's first answer to the question in any round. */
    first_answer: boolean | null;
  };
  /** Current Telegram name observed by the Trainer; absence does not exclude the person. */
  trainer_rating_profiles: {
    bot_identity: string;
    telegram_user_id: TelegramId;
    display_name: string;
    observed_at: Timestamp;
  };
  /** Historical choices, retained unchanged. They no longer control Rating participation. */
  trainer_rating_consents: {
    bot_identity: string;
    telegram_user_id: TelegramId;
    shown: boolean;
    /**
     * The name retained with the historical choice, null when that choice was to hide it.
     */
    display_name: string | null;
    /** When the bot received the person's latest choice. */
    decided_at: Timestamp;
  };
}
