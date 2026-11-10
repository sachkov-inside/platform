import { sql } from "kysely";

import type { Database } from "../../database/database.js";

/**
 * Answers credited by a completed round. Its completion time owns the day and week of the
 * credit. A first credited answer is chosen by completion order, so an abandoned round cannot
 * consume that first attempt.
 */
export function trainerCompletedAnswers(
  database: Pick<Database, "selectFrom">,
  botIdentity?: string,
  telegramUserId?: string,
) {
  let credited = database
    .selectFrom("trainer_issues as recorded")
    .innerJoin("trainer_rounds as round", "round.id", "recorded.round_id")
    .select([
      "recorded.id",
      "recorded.round_id",
      "recorded.bot_identity",
      "recorded.telegram_user_id",
      "recorded.question_id",
      "recorded.correct",
      "recorded.issued_at",
      "recorded.answered_at",
      "round.completed_at",
      sql<boolean>`row_number() over (
        partition by recorded.bot_identity, recorded.telegram_user_id, recorded.question_id
        order by round.completed_at, recorded.answered_at, recorded.id
      ) = 1`.as("first_completed_answer"),
    ])
    .where("round.completed_at", "is not", null)
    .where("recorded.answered_at", "is not", null);
  if (botIdentity !== undefined)
    credited = credited.where("recorded.bot_identity", "=", botIdentity);
  if (telegramUserId !== undefined)
    credited = credited.where("recorded.telegram_user_id", "=", telegramUserId);
  return database.selectFrom(credited.as("issue"));
}
