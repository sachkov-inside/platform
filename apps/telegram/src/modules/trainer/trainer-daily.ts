import { sql } from "kysely";

import type { Database } from "../../database/database.js";
import { moscowDay } from "./trainer-days.js";
export { moscowDay } from "./trainer-days.js";
import {
  correctMaskOf,
  severalBits,
  showRoundStep,
  type TrainerAnswerOutcome,
  type TrainerIssuedQuestion,
  type TrainerNothingToAsk,
  type TrainerPerson,
  type TrainerQuestionVersionUnavailable,
} from "./trainer-rounds.js";
import type { OptionMask } from "./widget/trainer-widget-wire.js";

/** The person's own request for the Daily question. */
export interface TrainerDailyRequest {
  /** The Telegram update that asks for the question. */
  readonly updateId: string;
  /** When the bot received the request; its Moscow day names the Daily question. */
  readonly at: Date;
}

/** The Daily question the person has already answered, with the picked options. */
export interface TrainerDailyReview {
  readonly kind: "review";
  readonly question: TrainerIssuedQuestion;
  /** The stored picked options; 0 is «Не знаю». */
  readonly pickedMask: OptionMask;
}

/** The Bank no longer shows today's question, and the person has not been asked it. */
export interface TrainerDailyWithdrawn {
  readonly kind: "withdrawn";
}

/**
 * The Daily question: one question per Moscow day, the same for every person of the bot. A
 * person answers it in a round of one question, once; later requests of that day show the
 * stored answer. Nothing here runs without a person's request.
 */
export class TrainerDaily {
  constructor(private readonly database: Database) {}

  /**
   * The Daily question of the request's Moscow day for this person: to answer, or to review
   * when the person has answered it. The first request of a day chooses the question.
   */
  async open(
    person: TrainerPerson,
    request: TrainerDailyRequest,
  ): Promise<
    | TrainerIssuedQuestion
    | TrainerDailyReview
    | TrainerDailyWithdrawn
    | TrainerNothingToAsk
    | TrainerQuestionVersionUnavailable
  > {
    const day = moscowDay(request.at);
    const questionId = await this.questionOf(
      person.botIdentity,
      day,
      request.at,
    );
    if (questionId === undefined)
      return { kind: "nothing", reason: "no_questions" };

    return this.database.transaction().execute(async (tx) => {
      // A repeated run of the same update finds the round its first run started.
      const started = await tx
        .selectFrom("trainer_rounds")
        .select("id")
        .where("bot_identity", "=", person.botIdentity)
        .where("telegram_user_id", "=", person.telegramUserId)
        .where(sql<boolean>`daily_day = ${day}::date`)
        .executeTakeFirst();
      const roundId =
        started?.id ?? (await start(tx, person, request, day, questionId));
      if (roundId === undefined) return { kind: "withdrawn" };

      const step = await showRoundStep(tx, roundId, request.at);
      if (step.kind === "version_unavailable") return step;
      if (step.kind === "result" && step.round.marks.length === 0)
        return { kind: "withdrawn" };
      return step.kind === "question" ? step : review(tx, roundId);
    });
  }

  /** True when the person has answered the Daily question of this instant's Moscow day. */
  async answered(person: TrainerPerson, at: Date): Promise<boolean> {
    const answer = await this.database
      .selectFrom("trainer_rounds as round")
      .innerJoin("trainer_issues as issue", "issue.round_id", "round.id")
      .select("issue.id")
      .where("round.bot_identity", "=", person.botIdentity)
      .where("round.telegram_user_id", "=", person.telegramUserId)
      .where(sql<boolean>`round.daily_day = ${moscowDay(at)}::date`)
      .where("issue.answered_at", "is not", null)
      .executeTakeFirst();
    return answer !== undefined;
  }

  /**
   * The line under the explanation of a Daily question: the share of correct answers and the
   * number of people who answered the question of that day, this person included. 0 for an
   * answer of another mode.
   */
  async statLine(outcome: TrainerAnswerOutcome): Promise<string | 0> {
    if (outcome.round.mode !== "daily") return 0;
    const { rows } = await sql<{ answered: number; correct: number }>`
      select
        count(*)::integer as answered,
        (count(*) filter (where issue.correct))::integer as correct
      from trainer_rounds as mine
      join trainer_rounds as round
        on round.bot_identity = mine.bot_identity
        and round.daily_day = mine.daily_day
      join trainer_issues as issue on issue.round_id = round.id
      where mine.id = ${outcome.round.id}
        and issue.answered_at is not null
    `.execute(this.database);
    const [stat] = rows;
    if (!stat || stat.answered === 0) return 0;
    const percent = Math.round((stat.correct * 100) / stat.answered);
    return `Верно ответили ${String(percent)}% из ${String(stat.answered)} ${peopleAfterOf(stat.answered)}`;
  }

  /**
   * The question of the day, chosen now when the day has none: a random question the Bank
   * shows that has not been a Daily question in the current cycle; when every such question
   * has been one, the next cycle starts over the whole Bank. Of several first requests that
   * meet here, the primary key keeps one choice and the others read it. `undefined`: the
   * Bank shows no question.
   */
  private async questionOf(
    botIdentity: string,
    day: string,
    at: Date,
  ): Promise<string | undefined> {
    await sql`
      with current as (
        select coalesce(max(cycle), 1) as cycle
        from trainer_daily_questions
        where bot_identity = ${botIdentity}
      ),
      fresh as (
        select question.id
        from trainer_questions as question, current
        where question.withdrawn_at is null
          and not exists (
            select from trainer_daily_questions as used
            where used.bot_identity = ${botIdentity}
              and used.cycle = current.cycle
              and used.question_id = question.id
          )
      ),
      choice as (
        select fresh.id, current.cycle from fresh, current
        union all
        select question.id, current.cycle + 1
        from trainer_questions as question, current
        where question.withdrawn_at is null and not exists (select from fresh)
      )
      insert into trainer_daily_questions
        (bot_identity, day, question_id, cycle, chosen_at)
      select ${botIdentity}, ${day}::date, choice.id, choice.cycle, ${at}
      from choice
      order by random()
      limit 1
      on conflict (bot_identity, day) do nothing
    `.execute(this.database);
    const chosen = await this.database
      .selectFrom("trainer_daily_questions")
      .select("question_id")
      .where("bot_identity", "=", botIdentity)
      .where(sql<boolean>`day = ${day}::date`)
      .executeTakeFirst();
    return chosen?.question_id;
  }
}

/**
 * Starts the person's round of the day's question and returns its id; `undefined` when the
 * Bank no longer shows the question.
 */
async function start(
  database: Database,
  person: TrainerPerson,
  request: TrainerDailyRequest,
  day: string,
  questionId: string,
): Promise<string | undefined> {
  const question = await database
    .selectFrom("trainer_questions")
    .select(["id", "content_revision", "options"])
    .where("id", "=", questionId)
    .where("withdrawn_at", "is", null)
    .executeTakeFirst();
  if (!question) return undefined;
  const round = await database
    .insertInto("trainer_rounds")
    .values({
      bot_identity: person.botIdentity,
      telegram_user_id: person.telegramUserId,
      mode: "daily",
      topic_code: null,
      size: 1,
      started_at: request.at,
      update_id: request.updateId,
      daily_day: day,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await database
    .insertInto("trainer_issues")
    .values({
      round_id: round.id,
      position: 1,
      bot_identity: person.botIdentity,
      telegram_user_id: person.telegramUserId,
      question_id: question.id,
      content_revision: question.content_revision,
      option_count: question.options.length,
      correct_mask: correctMaskOf(question.options),
    })
    .execute();
  return round.id;
}

/** The answered question of a Daily question round with the options the person picked. */
async function review(
  database: Database,
  roundId: string,
): Promise<TrainerDailyReview | TrainerQuestionVersionUnavailable> {
  const answer = await database
    .selectFrom("trainer_issues as issue")
    .innerJoin(
      "trainer_questions as question",
      "question.id",
      "issue.question_id",
    )
    .innerJoin("trainer_topics as topic", "topic.code", "question.topic_code")
    .leftJoin("trainer_question_versions as version", (join) =>
      join
        .onRef("version.question_id", "=", "issue.question_id")
        .onRef("version.content_revision", "=", "issue.content_revision"),
    )
    .select([
      "issue.id",
      "issue.question_id",
      "issue.picked_mask",
      "issue.correct",
      "issue.correct_mask",
      "version.text",
      "version.options",
      "topic.name as topic_name",
    ])
    .where("issue.round_id", "=", roundId)
    .where("issue.answered_at", "is not", null)
    .executeTakeFirstOrThrow();
  if (answer.picked_mask === null || answer.correct === null)
    throw new Error(`Trainer issue ${answer.id} has no stored answer`);
  if (answer.text === null || answer.options === null)
    return { kind: "version_unavailable" };
  return {
    kind: "review",
    pickedMask: answer.picked_mask,
    question: {
      kind: "question",
      round: {
        id: roundId,
        mode: "daily",
        topicCode: null,
        completed: true,
        size: 1,
        marks: answer.correct ? "1" : "0",
      },
      issueId: BigInt(answer.id).toString(36),
      questionId: answer.question_id,
      topicName: answer.topic_name,
      text: answer.text,
      options: answer.options.map((option) => option.text),
      severalCorrect: severalBits(answer.correct_mask),
    },
  };
}

/** «человека» or «человек» after «из» and a number: из 1 человека, из 5 человек. */
function peopleAfterOf(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? "человека" : "человек";
}
