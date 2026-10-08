import type { RawBuilder, Transaction } from "kysely";
import type { Database, DatabaseSchema } from "../../database/database.js";

export const SIGN_IN_REPLY_ELIGIBILITY = Symbol("SIGN_IN_REPLY_ELIGIBILITY");
export type SignInReplyEligibility = (
  database: Database | Transaction<DatabaseSchema>,
  now: Date,
  reply: { requestRef: string; editMessageId: string },
) => RawBuilder<boolean>;
