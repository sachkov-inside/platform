import type { Database } from "../../database/database.js";
import { trainerCompletedAnswers } from "./trainer-completed-answers.js";
import { trainerTopicsPage } from "./trainer-pages.js";
import type { TrainerPerson } from "./trainer-rounds.js";
import type { TrainerTopicsData } from "./widget/trainer-widget-wire.js";

/** A topic a person can train and how much of it the person has gone through. */
export interface TrainerTopicChoice {
  readonly code: string;
  /** The topic's name as the Bank gives it. */
  readonly name: string;
  /** Shown questions of the topic the person has answered at least once, whatever the answer. */
  readonly answered: number;
  /** Questions of the topic the Bank shows now. */
  readonly total: number;
}

/**
 * The topics of «Тренировка по теме» as one person sees them. The list and the names come from
 * the Bank: a topic is listed while the Bank shows it and it has a question to ask.
 */
export class TrainerTopics {
  constructor(private readonly database: Database) {}

  /** Every topic the person can choose, in the Bank's order, with the person's counter. */
  async list(person: TrainerPerson): Promise<TrainerTopicChoice[]> {
    const rows = await this.database
      .selectFrom("trainer_topics as topic")
      .innerJoin("trainer_questions as question", (join) =>
        join
          .onRef("question.topic_code", "=", "topic.code")
          .on("question.withdrawn_at", "is", null),
      )
      .where("topic.withdrawn_at", "is", null)
      .groupBy(["topic.code", "topic.name", "topic.position"])
      .orderBy("topic.position")
      .select((eb) => [
        "topic.code",
        "topic.name",
        eb.fn.count<string>("question.id").as("total"),
        eb.fn
          .count<string>("question.id")
          .filterWhere(
            eb.exists(
              eb
                .selectFrom(
                  trainerCompletedAnswers(
                    this.database,
                    person.botIdentity,
                    person.telegramUserId,
                  )
                    .selectAll("issue")
                    .as("passed"),
                )
                .select("passed.id")
                .whereRef("passed.question_id", "=", "question.id"),
            ),
          )
          .as("answered"),
      ])
      .execute();
    return rows.map(({ code, name, answered, total }) => ({
      code,
      name,
      answered: Number(answered),
      total: Number(total),
    }));
  }

  /** The name of a topic by its code, also after the Bank dropped the topic. */
  async name(code: string): Promise<string | undefined> {
    const topic = await this.database
      .selectFrom("trainer_topics")
      .select("name")
      .where("code", "=", code)
      .executeTakeFirst();
    return topic?.name;
  }
}

/** The topic choice screen. */
export function topicsScreen(
  topics: readonly TrainerTopicChoice[],
  requestedPage = 0,
): TrainerTopicsData {
  const { rows, page, pages } = trainerTopicsPage(topics, requestedPage);
  const data: readonly ["t", TrainerTopicsData[1]] = [
    "t",
    rows.map(({ code, name, answered, total }) => [
      code,
      name,
      answered,
      total,
    ]),
  ];
  return pages > 1 ? [...data, page, pages] : data;
}
