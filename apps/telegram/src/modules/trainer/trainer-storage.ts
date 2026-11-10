import type { ColumnType } from "kysely";

import type {
  TrainerBankOption,
  TrainerBankQuestion,
} from "./trainer-bank-file.js";

type Timestamp = ColumnType<Date, Date, Date>;
type OptionalTimestamp = ColumnType<
  Date | null,
  Date | null | undefined,
  Date | null
>;

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
}
