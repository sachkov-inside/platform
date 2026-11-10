import { sql } from "kysely";

import type { Database } from "../../database/database.js";
import {
  moscowDayNumberSql,
  moscowDayNumber,
  moscowDayWindow,
} from "./trainer-days.js";
import { trainerPointsOf } from "./trainer-points.js";
import type { TrainerPerson } from "./trainer-rounds.js";
import type { TrainerProgressData } from "./widget/trainer-widget-wire.js";

// What a person's stored answers add up to: the Series, the Daily goal and the Progress
// screen. Everything is read from the answers at the moment of the request; nothing is stored.

type Reader = Pick<Database, "selectFrom">;

/** A person's answers, each stored once, in any mode. */
const answersOf = (database: Reader, person: TrainerPerson) =>
  database
    .selectFrom("trainer_issues as issue")
    .where("issue.bot_identity", "=", person.botIdentity)
    .where("issue.telegram_user_id", "=", person.telegramUserId)
    .where("issue.answered_at", "is not", null);

const count = (
  query: ReturnType<typeof answersOf>,
): Promise<{ answers: number }> =>
  query
    .select((eb) => eb.cast<number>(eb.fn.countAll(), "integer").as("answers"))
    .executeTakeFirstOrThrow();

/**
 * The Series at this instant: Moscow days in a row with at least one answer, counted back
 * from today, or from yesterday while today has no answer yet. A missed day ends the Series.
 */
export async function trainerStreakDays(
  database: Reader,
  person: TrainerPerson,
  at: Date,
): Promise<number> {
  const today = moscowDayNumber(at);
  const moscowDayOfAnswer = moscowDayNumberSql("issue.answered_at");
  const days = answersOf(database, person)
    .select(moscowDayOfAnswer.as("day"))
    .distinct();
  // Days are numbered from the latest one: in an unbroken run a day and its number in the
  // run always add up to the same sum, and the first gap changes it.
  const { streak } = await database
    .selectFrom(
      database
        .selectFrom(days.as("answered"))
        .select((eb) => [
          "answered.day",
          sql<number>`row_number() over (order by answered.day desc)`.as("nth"),
          eb.fn.max("answered.day").over().as("latest"),
        ])
        .where("answered.day", "<=", today)
        .as("run"),
    )
    .select((eb) => eb.cast<number>(eb.fn.countAll(), "integer").as("streak"))
    .where("run.latest", ">=", today - 1)
    .where(sql<boolean>`run.day + run.nth = run.latest + 1`)
    .executeTakeFirstOrThrow();
  return streak;
}

/** Answers of the person in the Moscow day of this instant, whatever the verdict or the mode. */
export async function trainerAnswersToday(
  database: Reader,
  person: TrainerPerson,
  at: Date,
): Promise<number> {
  const { from, until } = moscowDayWindow(at);
  const { answers } = await count(
    answersOf(database, person)
      .where("issue.answered_at", ">=", from)
      .where("issue.answered_at", "<", until),
  );
  return answers;
}

/** One topic of the Bank as the Progress screen shows it. */
export interface TrainerTopicProgress {
  readonly name: string;
  /** Questions the Bank shows in the topic. */
  readonly questions: number;
  /** Those of them the person has answered at least once. */
  readonly passed: number;
  /** Those of them whose first answer was correct. */
  readonly correctFirst: number;
}

export interface TrainerProgress {
  readonly points: number;
  readonly streakDays: number;
  /** Every answer the person has given, repeated questions included. */
  readonly answers: number;
  /** Complete: every topic the Bank shows questions of, in the Bank's order. */
  readonly topics: readonly TrainerTopicProgress[];
}

/** The person's whole Progress at this instant. */
export async function trainerProgress(
  database: Reader,
  person: TrainerPerson,
  at: Date,
): Promise<TrainerProgress> {
  const topics = await database
    .selectFrom("trainer_topics as topic")
    .innerJoin("trainer_questions as question", (join) =>
      join
        .onRef("question.topic_code", "=", "topic.code")
        .on("question.withdrawn_at", "is", null),
    )
    // At most one row per question: a person has one first answer to it.
    .leftJoin("trainer_issues as first", (join) =>
      join
        .onRef("first.question_id", "=", "question.id")
        .on("first.bot_identity", "=", person.botIdentity)
        .on("first.telegram_user_id", "=", person.telegramUserId)
        .on("first.first_answer", "=", true),
    )
    .select((eb) => [
      "topic.name",
      eb.cast<number>(eb.fn.count("question.id"), "integer").as("questions"),
      eb.cast<number>(eb.fn.count("first.id"), "integer").as("passed"),
      eb
        .cast<number>(
          eb.fn.count("first.id").filterWhere("first.correct", "=", true),
          "integer",
        )
        .as("correctFirst"),
    ])
    .where("topic.withdrawn_at", "is", null)
    .groupBy(["topic.code", "topic.position"])
    .orderBy("topic.position")
    .execute();
  return {
    points: await trainerPointsOf(database, person),
    streakDays: await trainerStreakDays(database, person, at),
    answers: (await count(answersOf(database, person))).answers,
    topics,
  };
}

/** The Progress screen. A topic with no answered question is "not started" (-1). */
export function progressScreen(progress: TrainerProgress): TrainerProgressData {
  return [
    "p",
    progress.points,
    progress.streakDays,
    progress.answers,
    progress.topics.map((topic) => [
      topic.name,
      topic.passed,
      topic.questions,
      topic.passed === 0
        ? -1
        : Math.round((100 * topic.correctFirst) / topic.passed),
    ]),
  ];
}
