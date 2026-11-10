import { sql } from "kysely";

import type { Database } from "../../database/database.js";
import {
  trainerAnswerExplanation,
  type TrainerBankOption,
} from "./trainer-bank-file.js";
import { trainerCodeFormat } from "./trainer-identifiers.js";
import { DAY_SECONDS } from "./trainer-days.js";
import { trainerCompletedAnswers } from "./trainer-completed-answers.js";
import { earnsTrainerPoint } from "./trainer-points.js";
import type { TrainerRoundMode } from "./trainer-storage.js";
import type { OptionMask, RoundMarks } from "./widget/trainer-widget-wire.js";

/** A question the person answered correctly does not come back for this many days. */
const CORRECT_ANSWER_REST_DAYS = 30;

/** The largest issue number PostgreSQL stores (bigint). */
const LARGEST_ISSUE_NUMBER = 2n ** 63n - 1n;

/** The BotContact a round belongs to. */
export interface TrainerPerson {
  readonly botIdentity: string;
  readonly telegramUserId: string;
}

/** What a mode asks of a new round. */
export interface TrainerRoundRequest {
  readonly mode: TrainerRoundMode;
  /** Only questions of this topic; required by the `topic` mode and absent in the others. */
  readonly topicCode?: string;
  /** The most questions the round asks; it is shorter when fewer can be asked. */
  readonly count: number;
  /** The Telegram update that asks for the round: its repeated run continues the same round. */
  readonly updateId: string;
  /** When the bot received the request. */
  readonly at: Date;
}

/** A round and how far the person is in it. */
export interface TrainerRound {
  readonly id: string;
  readonly mode: TrainerRoundMode;
  readonly topicCode: string | null;
  /** Steps in the round. */
  readonly size: number;
  /** One digit per answered step, in the order of the steps: "1" correct, "0" wrong. */
  readonly marks: RoundMarks;
}

/** A question shown to the person. It never says which option is correct. */
export interface TrainerIssuedQuestion {
  readonly kind: "question";
  readonly round: TrainerRound;
  /** Names the issue in the widget's answer: 1-16 lowercase Latin letters and digits. */
  readonly issueId: string;
  readonly questionId: string;
  readonly topicName: string;
  readonly text: string;
  readonly options: readonly string[];
  readonly severalCorrect: boolean;
}

/** Every step of the round is answered. */
export interface TrainerRoundResult {
  readonly kind: "result";
  readonly round: TrainerRound;
  readonly correct: number;
}

/** No round started: the Bank has nothing to show, or the person knows all of it for now. */
export interface TrainerNothingToAsk {
  readonly kind: "nothing";
  readonly reason: "no_questions" | "all_answered_correctly";
}

/** The stored answer to an issue and what the person may now see. */
export interface TrainerAnswerOutcome {
  readonly round: TrainerRound;
  readonly questionId: string;
  /** The stored picked options; 0 is «Не знаю». */
  readonly pickedMask: OptionMask;
  readonly correctMask: OptionMask;
  readonly correct: boolean;
  /** The person's first credited answer to this question, false while its round is unfinished. */
  readonly firstAnswer: boolean;
  /** The answer earned a point. */
  readonly point: boolean;
  readonly issuedAt: Date;
  readonly answeredAt: Date;
  readonly explanation: string;
}

type Candidate = { readonly id: string; readonly topic_code: string };

/**
 * Rounds of every Trainer mode: which questions a person gets, which of them the person has
 * been shown, and the one answer to each. The bot's own rows decide everything; a request from
 * the widget only names an issue and the picked options.
 */
export class TrainerRounds {
  constructor(private readonly database: Database) {}

  /**
   * Starts a round and shows its first question. The questions are chosen once, at the start.
   * A repeated run of the same update continues the round it started the first time.
   */
  async start(
    person: TrainerPerson,
    request: TrainerRoundRequest,
  ): Promise<TrainerIssuedQuestion | TrainerRoundResult | TrainerNothingToAsk> {
    return this.database.transaction().execute(async (tx) => {
      const started = await tx
        .selectFrom("trainer_rounds")
        .select("id")
        .where("bot_identity", "=", person.botIdentity)
        .where("update_id", "=", request.updateId)
        .executeTakeFirst();
      if (started) return showRoundStep(tx, started.id, request.at);

      const questions = await chooseQuestions(tx, person, request);
      if (questions.length === 0)
        return {
          kind: "nothing",
          reason: (await hasQuestions(tx, request.topicCode))
            ? "all_answered_correctly"
            : "no_questions",
        };
      const round = await tx
        .insertInto("trainer_rounds")
        .values({
          bot_identity: person.botIdentity,
          telegram_user_id: person.telegramUserId,
          mode: request.mode,
          topic_code: request.topicCode ?? null,
          size: questions.length,
          started_at: request.at,
          update_id: request.updateId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("trainer_issues")
        .values(
          questions.map((question, index) => ({
            round_id: round.id,
            position: index + 1,
            bot_identity: person.botIdentity,
            telegram_user_id: person.telegramUserId,
            question_id: question.id,
            content_revision: question.content_revision,
            option_count: question.options.length,
            correct_mask: correctMaskOf(question.options),
          })),
        )
        .execute();
      return showRoundStep(tx, round.id, request.at);
    });
  }

  /**
   * Records the person's answer to an issued question, once. `undefined` rejects the request:
   * the issue is not this person's, was not shown yet, or the picked options do not fit the
   * question. An issue that already has an answer keeps it: the outcome is the stored answer,
   * whatever this request picked.
   */
  async answer(
    person: TrainerPerson,
    issueId: string,
    pickedMask: OptionMask,
    at: Date,
  ): Promise<TrainerAnswerOutcome | undefined> {
    return this.database.transaction().execute(async (database) => {
      const id = issueNumber(issueId);
      if (id === undefined) return undefined;
      const issue = await database
        .selectFrom("trainer_issues")
        .select(["issued_at", "answered_at", "option_count", "correct_mask"])
        .where("id", "=", id)
        .where("bot_identity", "=", person.botIdentity)
        .where("telegram_user_id", "=", person.telegramUserId)
        .executeTakeFirst();
      if (!issue || issue.issued_at === null) return undefined;
      if (issue.answered_at === null) {
        if (!fits(pickedMask, issue.option_count, issue.correct_mask))
          return undefined;
        // The guard on `answered_at` keeps the first answer when two runs meet here.
        await database
          .updateTable("trainer_issues as issue")
          .set({
            answered_at: at,
            picked_mask: pickedMask,
            correct: pickedMask === issue.correct_mask,
            first_answer: sql<boolean>`not exists (
              select from trainer_issues as earlier
              where earlier.bot_identity = issue.bot_identity
                and earlier.telegram_user_id = issue.telegram_user_id
                and earlier.question_id = issue.question_id
                and earlier.answered_at is not null
            )`,
          })
          .where("issue.id", "=", id)
          .where("issue.answered_at", "is", null)
          .execute();
      }

      const stored = await database
        .selectFrom("trainer_issues as issue")
        .innerJoin(
          "trainer_questions as question",
          "question.id",
          "issue.question_id",
        )
        .select([
          "issue.round_id",
          "issue.question_id",
          "issue.issued_at",
          "issue.answered_at",
          "issue.picked_mask",
          "issue.correct_mask",
          "issue.correct",
          "issue.first_answer",
          "question.options",
          "question.explanation",
        ])
        .where("issue.id", "=", id)
        .executeTakeFirstOrThrow();
      if (
        stored.issued_at === null ||
        stored.answered_at === null ||
        stored.picked_mask === null ||
        stored.correct === null ||
        stored.first_answer === null
      )
        throw new Error(`Trainer issue ${id} has no stored answer`);
      const round = await roundOf(database, stored.round_id);
      if (round.size > 0 && round.marks.length === round.size)
        await completeRound(database, round.id, at);
      const credited = await trainerCompletedAnswers(
        database,
        person.botIdentity,
        person.telegramUserId,
      )
        .select([
          "issue.first_completed_answer",
          earnsTrainerPoint("issue").as("point"),
        ])
        .where("issue.id", "=", id)
        .executeTakeFirst();
      return {
        round,
        questionId: stored.question_id,
        pickedMask: stored.picked_mask,
        correctMask: stored.correct_mask,
        correct: stored.correct,
        firstAnswer: credited?.first_completed_answer ?? false,
        point: credited?.point ?? false,
        issuedAt: stored.issued_at,
        answeredAt: stored.answered_at,
        explanation: trainerAnswerExplanation(stored, stored.picked_mask),
      };
    });
  }

  /**
   * The next step of the named answered issue’s round (legacy `n` uses the last answer): its next question, or its result
   * when every step is answered. `undefined`: the person has not answered anything yet.
   */
  async next(
    person: TrainerPerson,
    at: Date,
    issueId?: string,
  ): Promise<TrainerIssuedQuestion | TrainerRoundResult | undefined> {
    const id = issueId === undefined ? undefined : issueNumber(issueId);
    if (issueId !== undefined && id === undefined) return undefined;
    let query = this.database
      .selectFrom("trainer_issues")
      .select("round_id")
      .where("bot_identity", "=", person.botIdentity)
      .where("telegram_user_id", "=", person.telegramUserId)
      .where("answered_at", "is not", null)
      .orderBy("answered_at", "desc")
      .orderBy("id", "desc")
      .limit(1);
    if (id !== undefined) query = query.where("id", "=", id);
    const last = await query.executeTakeFirst();
    return last && showRoundStep(this.database, last.round_id, at);
  }
}

/**
 * Questions for a new round, in the order they are asked. Questions the person has not been
 * shown come first, then those not answered correctly, then those answered correctly more than
 * 30 days ago; a question answered correctly within 30 days is left out. Each group is in
 * random order. Topics do not repeat while another topic still has a question to give, so a
 * round over the whole Bank takes its questions from different topics.
 */
async function chooseQuestions(
  database: Database,
  person: TrainerPerson,
  request: TrainerRoundRequest,
) {
  const topic = request.topicCode ?? null;
  const restsSince = new Date(
    request.at.getTime() - CORRECT_ANSWER_REST_DAYS * DAY_SECONDS * 1000,
  );
  const history = trainerCompletedAnswers(
    database,
    person.botIdentity,
    person.telegramUserId,
  )
    .select([
      "issue.question_id",
      sql<boolean>`(array_agg(issue.correct order by issue.completed_at desc, issue.id desc))[1]`.as(
        "last_correct",
      ),
      sql<Date>`max(issue.completed_at)`.as("last_answered_at"),
    ])
    .groupBy("issue.question_id");
  const { rows } = await sql<{
    id: string;
    topic_code: string;
    content_revision: number;
    options: TrainerBankOption[];
  }>`
    select question.id, question.topic_code, question.content_revision, question.options
    from trainer_questions as question
    left join (${history}) as history on history.question_id = question.id
    where question.withdrawn_at is null
      and (${topic}::text is null or question.topic_code = ${topic})
      and not (
        coalesce(history.last_correct, false)
        and history.last_answered_at > ${restsSince}
      )
    order by
      case
        when history.question_id is null then 0
        when history.last_correct is distinct from true then 1
        else 2
      end,
      random()
  `.execute(database);
  const chosen = new Set(spreadOverTopics(rows, request.count));
  return rows.filter((row) => chosen.has(row));
}

/** The first `count` candidates whose topics differ, then the earliest of the rest. */
function spreadOverTopics<Row extends Candidate>(
  candidates: readonly Row[],
  count: number,
): Row[] {
  const topics = new Set<string>();
  const first: Row[] = [];
  const rest: Row[] = [];
  for (const candidate of candidates) {
    if (first.length < count && !topics.has(candidate.topic_code)) {
      topics.add(candidate.topic_code);
      first.push(candidate);
    } else rest.push(candidate);
  }
  return [...first, ...rest.slice(0, count - first.length)];
}

async function hasQuestions(
  database: Database,
  topicCode: string | undefined,
): Promise<boolean> {
  let query = database
    .selectFrom("trainer_questions")
    .select("id")
    .where("withdrawn_at", "is", null);
  if (topicCode !== undefined)
    query = query.where("topic_code", "=", topicCode);
  return (await query.limit(1).executeTakeFirst()) !== undefined;
}

/**
 * The step the round is on: its first unanswered question, shown now, or the result. Showing
 * stamps the issue once and records the question as it is shown.
 */
export async function showRoundStep(
  database: Database,
  roundId: string,
  at: Date,
): Promise<TrainerIssuedQuestion | TrainerRoundResult> {
  const round = await roundOf(database, roundId);
  const step = await database
    .selectFrom("trainer_issues as issue")
    .innerJoin(
      "trainer_questions as question",
      "question.id",
      "issue.question_id",
    )
    .innerJoin("trainer_topics as topic", "topic.code", "question.topic_code")
    .select([
      "issue.id",
      "issue.question_id",
      "question.text",
      "question.options",
      "question.content_revision",
      "topic.name as topic_name",
    ])
    .where("issue.round_id", "=", roundId)
    .where("issue.answered_at", "is", null)
    .where("question.withdrawn_at", "is", null)
    .orderBy("issue.position")
    .limit(1)
    .executeTakeFirst();
  if (!step) {
    if (round.size > 0 && round.marks.length === round.size)
      await completeRound(database, round.id, at);
    return {
      kind: "result",
      round,
      correct: round.marks.replaceAll("0", "").length,
    };
  }

  const correctMask = correctMaskOf(step.options);
  // The Bank may have changed the question since the round started: the answer is judged
  // against the options the person sees now.
  await database
    .updateTable("trainer_issues")
    .set((eb) => ({
      issued_at: eb.fn.coalesce("issued_at", eb.val(at)),
      content_revision: step.content_revision,
      option_count: step.options.length,
      correct_mask: correctMask,
    }))
    .where("id", "=", step.id)
    .where("answered_at", "is", null)
    .execute();
  return {
    kind: "question",
    round,
    issueId: BigInt(step.id).toString(36),
    questionId: step.question_id,
    topicName: step.topic_name,
    text: step.text,
    options: step.options.map((option) => option.text),
    severalCorrect: severalBits(correctMask),
  };
}

/** Completion is immutable; a repeated request cannot move its credit to another day. */
async function completeRound(
  database: Database,
  roundId: string,
  at: Date,
): Promise<void> {
  await database
    .updateTable("trainer_rounds")
    .set({ completed_at: at })
    .where("id", "=", roundId)
    .where("completed_at", "is", null)
    .execute();
}

async function roundOf(
  database: Database,
  roundId: string,
): Promise<TrainerRound> {
  const round = await database
    .selectFrom("trainer_rounds")
    .select(["id", "mode", "topic_code"])
    .where("id", "=", roundId)
    .executeTakeFirstOrThrow();
  const answered = await database
    .selectFrom("trainer_issues")
    .select("correct")
    .where("round_id", "=", roundId)
    .where("answered_at", "is not", null)
    .orderBy("position")
    .execute();
  const effective = await database
    .selectFrom("trainer_issues as issue")
    .innerJoin(
      "trainer_questions as question",
      "question.id",
      "issue.question_id",
    )
    .select(sql<number>`count(*)::integer`.as("size"))
    .where("issue.round_id", "=", roundId)
    .where((eb) =>
      eb.or([
        eb("issue.answered_at", "is not", null),
        eb("question.withdrawn_at", "is", null),
      ]),
    )
    .executeTakeFirstOrThrow();
  return {
    id: round.id,
    mode: round.mode,
    topicCode: round.topic_code,
    size: effective.size,
    marks: answered
      .map(({ correct }) => (correct === true ? "1" : "0"))
      .join(""),
  };
}

/** Bit `i` is set when option `i` is correct. */
export function correctMaskOf(
  options: readonly TrainerBankOption[],
): OptionMask {
  return options.reduce(
    (mask, option, index) => (option.correct ? mask | (1 << index) : mask),
    0,
  );
}

export const severalBits = (mask: OptionMask): boolean =>
  (mask & (mask - 1)) !== 0;

/**
 * True when the widget could have sent these options for the question: only existing options,
 * and at most one of them when the question has one correct option. 0 is «Не знаю».
 */
function fits(
  pickedMask: OptionMask,
  optionCount: number,
  correctMask: OptionMask,
): boolean {
  return (
    Number.isInteger(pickedMask) &&
    pickedMask >= 0 &&
    pickedMask < 1 << optionCount &&
    (severalBits(correctMask) || !severalBits(pickedMask))
  );
}

/** The stored number of an issue named by the widget; `undefined` when it cannot be one. */
function issueNumber(issueId: string): string | undefined {
  if (!trainerCodeFormat.test(issueId)) return undefined;
  let number = 0n;
  for (const digit of issueId)
    number = number * 36n + BigInt(parseInt(digit, 36));
  return number > LARGEST_ISSUE_NUMBER ? undefined : number.toString();
}
