import { sql } from "kysely";

import type { Database } from "../../database/database.js";
import { trainerCompletedAnswers } from "./trainer-completed-answers.js";
import { moscowDaySql as moscowDay } from "./trainer-days.js";

/** One stored question of the Bank with the answers people gave to it. */
export interface TrainerQuestionReportLine {
  /** The author's identifier of the question. */
  readonly question: string;
  readonly topic: string;
  readonly topicName: string;
  /** True when the question is no longer shown; its answers stay counted. */
  readonly withdrawn: boolean;
  /** Every credited answer, repeated ones included; «Не знаю» is an answer and is not correct. */
  readonly answers: number;
  readonly correct: number;
  /** `correct / answers` rounded to two digits; null when nobody answered. */
  readonly correctShare: number | null;
}

/** The label the usage report gives to openings that came without a source label. */
export const TRAINER_UNKNOWN_SOURCE = "неизвестна";

/** Openings of one Moscow day that came with one source label. */
export interface TrainerUsageSourceLine {
  /** The label of the Trainer link, or TRAINER_UNKNOWN_SOURCE. */
  readonly source: string;
  readonly openings: number;
  /** People who opened the Trainer with this label on this day. */
  readonly people: number;
  /** Those of `people` who completed a round on this day. */
  readonly answered: number;
}

/** One Moscow day on which somebody opened the Trainer or answered a question. */
export interface TrainerUsageReportLine {
  /** The Moscow calendar day, `YYYY-MM-DD`. */
  readonly day: string;
  readonly openings: number;
  /** People who opened the Trainer on this day. */
  readonly people: number;
  /** People who completed a round on this day, whenever they opened the Trainer. */
  readonly answered: number;
  /** A person who came with two labels on one day counts under both. */
  readonly sources: readonly TrainerUsageSourceLine[];
}

/**
 * The author's reports on the Trainer. They count people and never name them: no line carries
 * a name or a Telegram identifier.
 */
export class TrainerReports {
  constructor(private readonly db: Database) {}

  /** Every stored question in the Bank's topic order, withdrawn questions included. */
  async questions(): Promise<TrainerQuestionReportLine[]> {
    const rows = await this.db
      .selectFrom("trainer_questions as question")
      .innerJoin("trainer_topics as topic", "topic.code", "question.topic_code")
      .leftJoin(
        trainerCompletedAnswers(this.db).selectAll("issue").as("issue"),
        (join) =>
          join
            .onRef("issue.question_id", "=", "question.id")
            .on("issue.answered_at", "is not", null),
      )
      .groupBy([
        "question.id",
        "question.withdrawn_at",
        "topic.code",
        "topic.name",
        "topic.position",
      ])
      .orderBy("topic.position")
      .orderBy("question.id")
      .select((eb) => [
        "question.id",
        "question.withdrawn_at",
        "topic.code",
        "topic.name",
        eb.fn.count<string>("issue.id").as("answers"),
        eb.fn
          .count<string>("issue.id")
          .filterWhere("issue.correct", "=", true)
          .as("correct"),
      ])
      .execute();
    return rows.map((row) => {
      const answers = Number(row.answers);
      const correct = Number(row.correct);
      return {
        question: row.id,
        topic: row.code,
        topicName: row.name,
        withdrawn: row.withdrawn_at !== null,
        answers,
        correct,
        correctShare:
          answers === 0 ? null : Math.round((correct / answers) * 100) / 100,
      };
    });
  }

  /**
   * Every Moscow day with an opening or an answer, oldest first. Each request to open the
   * Trainer is an opening, whatever became of its widget message. Within a day the labels go in
   * alphabetical order and the openings without a label go last.
   */
  async usage(): Promise<TrainerUsageReportLine[]> {
    const completed = trainerCompletedAnswers(this.db).selectAll("issue");
    const days = await sql<{
      day: string;
      openings: number;
      people: number;
      answered: number;
    }>`
      with opened as (
        select
          ${moscowDay("opened_at")} as day,
          count(*)::int as openings,
          count(distinct (bot_identity, telegram_user_id))::int as people
        from trainer_openings
        group by 1
      ),
      answered as (
        select
          ${moscowDay("completed_at")} as day,
          count(distinct (bot_identity, telegram_user_id))::int as answered
        from (${completed}) as issue
        group by 1
      )
      select
        to_char(day, 'YYYY-MM-DD') as day,
        coalesce(opened.openings, 0) as openings,
        coalesce(opened.people, 0) as people,
        coalesce(answered.answered, 0) as answered
      from opened
      full join answered using (day)
      order by day
    `.execute(this.db);
    const sources = await sql<{
      day: string;
      source: string | null;
      openings: number;
      people: number;
      answered: number;
    }>`
      select
        to_char(opening.day, 'YYYY-MM-DD') as day,
        opening.source_code as source,
        count(*)::int as openings,
        count(distinct (opening.bot_identity, opening.telegram_user_id))::int as people,
        count(distinct (opening.bot_identity, opening.telegram_user_id))
          filter (where exists (
            select
            from (${completed}) as issue
            where issue.bot_identity = opening.bot_identity
              and issue.telegram_user_id = opening.telegram_user_id
              and issue.completed_at >= opening.day at time zone 'Europe/Moscow'
              and issue.completed_at < (opening.day + interval '1 day') at time zone 'Europe/Moscow'
          ))::int as answered
      from (
        select *, ${moscowDay("opened_at")}::timestamp as day
        from trainer_openings
      ) as opening
      group by opening.day, opening.source_code
      order by opening.day, opening.source_code nulls last
    `.execute(this.db);
    return days.rows.map((day) => ({
      ...day,
      sources: sources.rows
        .filter((source) => source.day === day.day)
        .map(({ source, openings, people, answered }) => ({
          source: source ?? TRAINER_UNKNOWN_SOURCE,
          openings,
          people,
          answered,
        })),
    }));
  }
}
