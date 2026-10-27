import { sql, type Transaction } from "kysely";
import type { Database, DatabaseSchema } from "../../database/database.js";
import { isTruthy } from "../../shared/truthiness.js";

export async function signInAllowsLink(
  tx: Transaction<DatabaseSchema>,
  bot: string,
  user: string,
  request: string,
): Promise<boolean> {
  const reservation = await tx
    .selectFrom("sign_in_subjects")
    .select("reserved_for_sign_in")
    .where("bot_identity", "=", bot)
    .where("telegram_user_id", "=", user)
    .executeTakeFirst();
  const proof = await tx
    .selectFrom("sign_in_requests")
    .select("request_ref")
    .where("request_ref", "=", request)
    .where("bot_identity", "=", bot)
    .where("telegram_user_id", "=", user)
    .where("state", "=", "consumed")
    .executeTakeFirst();
  return !isTruthy(reservation?.reserved_for_sign_in) || proof !== undefined;
}

/** Whether a link source belongs to bot sign-in, which already has its own completion message. */
export async function isSignInLinkSource(
  database: Database | Transaction<DatabaseSchema>,
  sourceRef: string,
): Promise<boolean> {
  const request = await database
    .selectFrom("sign_in_requests")
    .select("request_ref")
    .where(sql<boolean>`request_ref::text = ${sourceRef}`)
    .executeTakeFirst();
  return request !== undefined;
}
