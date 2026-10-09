import type { Transaction } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";

export async function planInitialMembershipCheck(
  transaction: Transaction<DatabaseSchema>,
  sourceRef: string,
  telegramIdentityRef: string,
  createdAt: Date,
): Promise<void> {
  await transaction
    .insertInto("membership_checks")
    .values({
      attempt_count: 0,
      available_at: createdAt,
      completed_at: null,
      created_at: createdAt,
      diagnostic_code: null,
      locked_at: null,
      source_ref: sourceRef,
      state: "pending",
      telegram_identity_ref: telegramIdentityRef,
    })
    .onConflict((conflict) => conflict.column("source_ref").doNothing())
    .execute();
}
