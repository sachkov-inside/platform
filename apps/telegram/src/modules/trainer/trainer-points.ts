import { sql, type RawBuilder } from "kysely";

import type { Database } from "../../database/database.js";
import { trainerCompletedAnswers } from "./trainer-completed-answers.js";
import type { TrainerTimeWindow } from "./trainer-days.js";

// Points of the Trainer. Nothing stores a point: it follows from the stored answer, so the one
// rule here decides it for every mode, every screen and the Rating. Points open no access and
// change no price: nothing outside the Trainer reads them.

/** A point needs the answer within this many seconds after the question was shown. */
export const TRAINER_POINT_SECONDS = 90;

type Reader = Pick<Database, "selectFrom">;

/**
 * The rule of a point on a completed-answer query named `issue`: the answer is correct,
 * it is the person's first credited answer to the question, and the bot received it
 * within 90 seconds after it showed the question. A repeated answer, «Не знаю» and a late
 * answer give no point.
 */
export function earnsTrainerPoint(issue: string): RawBuilder<boolean> {
  return sql<boolean>`(
    ${sql.ref(`${issue}.correct`)}
    and ${sql.ref(`${issue}.first_completed_answer`)}
    and ${sql.ref(`${issue}.answered_at`)} - ${sql.ref(`${issue}.issued_at`)}
      <= make_interval(secs => ${TRAINER_POINT_SECONDS})
  )`;
}

/**
 * Points by person: one row (`telegram_user_id`, `points`) for every person of the bot who
 * earned a point with an answer inside the window; without a window, with any answer. The
 * query is unfinished on purpose: the caller narrows it to people, joins it, or sorts and
 * bounds it. Its table is named `issue`.
 */
export function trainerPointsByPerson(
  database: Reader,
  botIdentity: string,
  window: TrainerTimeWindow = {},
) {
  let points = trainerCompletedAnswers(database, botIdentity)
    .select((eb) => [
      "issue.telegram_user_id",
      eb.cast<number>(eb.fn.countAll(), "integer").as("points"),
    ])
    .where("issue.bot_identity", "=", botIdentity)
    .where(earnsTrainerPoint("issue"))
    .groupBy("issue.telegram_user_id");
  if (window.from)
    points = points.where("issue.completed_at", ">=", window.from);
  if (window.until)
    points = points.where("issue.completed_at", "<", window.until);
  return points;
}

/** One person's points for answers inside the window; without a window, all their points. */
export async function trainerPointsOf(
  database: Reader,
  person: { readonly botIdentity: string; readonly telegramUserId: string },
  window: TrainerTimeWindow = {},
): Promise<number> {
  const row = await trainerPointsByPerson(database, person.botIdentity, window)
    .where("issue.telegram_user_id", "=", person.telegramUserId)
    .executeTakeFirst();
  return row?.points ?? 0;
}

/** Points the answers of one round earned. */
export async function trainerPointsOfRound(
  database: Reader,
  person: { readonly botIdentity: string; readonly telegramUserId: string },
  roundId: string,
): Promise<number> {
  const { points } = await trainerCompletedAnswers(
    database,
    person.botIdentity,
    person.telegramUserId,
  )
    .select((eb) => eb.cast<number>(eb.fn.countAll(), "integer").as("points"))
    .where("issue.round_id", "=", roundId)
    .where(earnsTrainerPoint("issue"))
    .executeTakeFirstOrThrow();
  return points;
}
