import { sql } from "kysely";

import type { Database } from "../../database/database.js";
import type { Clock } from "../../shared/clock.js";
import {
  readTrainerBankFile,
  type TrainerBankFile,
  type TrainerBankFileError,
  type TrainerBankQuestion,
} from "./trainer-bank-file.js";

/** What an import does to the stored questions. The first four add up to the file's questions. */
export interface TrainerBankImportCounts {
  readonly added: number;
  /** Shown before, and the file changes its content. */
  readonly updated: number;
  readonly unchanged: number;
  /** Withdrawn before, and the file has it again. */
  readonly restored: number;
  /** Shown before, and the file no longer has it. */
  readonly withdrawn: number;
}

export type TrainerBankImportReport =
  | {
      readonly status: "rejected";
      readonly errors: readonly TrainerBankFileError[];
    }
  | {
      /** `valid`: a preview, nothing is written. `imported`: the database follows the file. */
      readonly status: "valid" | "imported";
      readonly topics: number;
      readonly questions: TrainerBankImportCounts;
    };

/** A topic people can choose, with the number of its questions that are shown. */
export interface TrainerBankTopic {
  readonly code: string;
  readonly name: string;
  readonly questions: number;
}

/** A stored question. `source` and `checkedAt` are the author's and never go to the widget. */
export interface StoredTrainerQuestion extends TrainerBankQuestion {
  readonly contentRevision: number;
  readonly addedAt: Date;
  /** Not null: the question is no longer shown; answers given to it stay. */
  readonly withdrawnAt: Date | null;
}

/** The Trainer's Bank of questions: the owner's import and the reads of the stored Bank. */
export class TrainerBank {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  /**
   * Checks the whole file first; a rejected file changes nothing. With `apply` the database then
   * follows the file in one transaction: questions keep their identifiers, a question the file
   * no longer has is withdrawn and stays stored.
   */
  async import(
    input: unknown,
    apply: boolean,
  ): Promise<TrainerBankImportReport> {
    const file = readTrainerBankFile(input);
    if (file.status === "rejected") return file;
    const { bank } = file;
    const now = this.clock.now();

    return this.db.transaction().execute(async (tx) => {
      // Two imports at once would each withdraw what the other has just added.
      await sql`select pg_advisory_xact_lock(hashtextextended('trainer-bank-import', 0))`.execute(
        tx,
      );
      const stored = new Map(
        (
          await tx
            .selectFrom("trainer_questions")
            .select([
              "id",
              "topic_code",
              "format",
              "text",
              "options",
              "explanation",
              "source",
              sql<string>`to_char(checked_on, 'YYYY-MM-DD')`.as("checked_at"),
              "withdrawn_at",
            ])
            .execute()
        ).map((row) => [
          row.id,
          {
            withdrawn: row.withdrawn_at !== null,
            content: contentOf({
              id: row.id,
              topic: row.topic_code,
              format: row.format,
              text: row.text,
              options: row.options,
              explanation: row.explanation,
              source: row.source,
              checkedAt: row.checked_at,
            }),
          },
        ]),
      );

      const changed: TrainerBankQuestion[] = [];
      const returned: string[] = [];
      const counts = { added: 0, updated: 0, unchanged: 0, restored: 0 };
      for (const question of bank.questions) {
        const before = stored.get(question.id);
        const same = before?.content === contentOf(question);
        if (!same) changed.push(question);
        if (before === undefined) counts.added += 1;
        else if (before.withdrawn) {
          counts.restored += 1;
          if (same) returned.push(question.id);
        } else if (same) counts.unchanged += 1;
        else counts.updated += 1;
      }
      const kept = new Set(bank.questions.map(({ id }) => id));
      const gone = [...stored]
        .filter(([id, { withdrawn }]) => !withdrawn && !kept.has(id))
        .map(([id]) => id);
      const report = {
        topics: bank.topics.length,
        questions: { ...counts, withdrawn: gone.length },
      };
      if (!apply) return { status: "valid", ...report } as const;

      await writeTopics(tx, bank, now);
      if (changed.length > 0)
        await tx
          .insertInto("trainer_questions")
          .values(
            changed.map((question) => ({
              id: question.id,
              topic_code: question.topic,
              format: question.format,
              text: question.text,
              options: JSON.stringify(question.options),
              explanation: question.explanation,
              source: question.source,
              checked_on: question.checkedAt,
              added_at: now,
              updated_at: now,
            })),
          )
          .onConflict((conflict) =>
            conflict.column("id").doUpdateSet((eb) => ({
              topic_code: eb.ref("excluded.topic_code"),
              format: eb.ref("excluded.format"),
              text: eb.ref("excluded.text"),
              options: eb.ref("excluded.options"),
              explanation: eb.ref("excluded.explanation"),
              source: eb.ref("excluded.source"),
              checked_on: eb.ref("excluded.checked_on"),
              content_revision: sql<number>`trainer_questions.content_revision + 1`,
              updated_at: eb.ref("excluded.updated_at"),
              withdrawn_at: null,
            })),
          )
          .execute();
      if (returned.length > 0)
        await tx
          .updateTable("trainer_questions")
          .set({ withdrawn_at: null, updated_at: now })
          .where("id", "in", returned)
          .execute();
      if (gone.length > 0)
        await tx
          .updateTable("trainer_questions")
          .set({ withdrawn_at: now, updated_at: now })
          .where("id", "in", gone)
          .execute();
      return { status: "imported", ...report } as const;
    });
  }

  /**
   * The complete list of topics people can choose, in the Bank's order. The import keeps it
   * within TRAINER_TOPICS_MAX, and every listed topic has at least one shown question.
   */
  async topics(): Promise<TrainerBankTopic[]> {
    const rows = await this.db
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
        eb.fn.count<string>("question.id").as("questions"),
      ])
      .execute();
    return rows.map(({ code, name, questions }) => ({
      code,
      name,
      questions: Number(questions),
    }));
  }

  /** One stored question by the author's identifier, withdrawn ones included. */
  async question(id: string): Promise<StoredTrainerQuestion | undefined> {
    const row = await this.db
      .selectFrom("trainer_questions")
      .select([
        "id",
        "topic_code",
        "format",
        "text",
        "options",
        "explanation",
        "source",
        sql<string>`to_char(checked_on, 'YYYY-MM-DD')`.as("checked_at"),
        "content_revision",
        "added_at",
        "withdrawn_at",
      ])
      .where("id", "=", id)
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : {
          id: row.id,
          topic: row.topic_code,
          format: row.format,
          text: row.text,
          options: row.options.map(({ text, correct, explanation }) => ({
            text,
            correct,
            explanation,
          })),
          explanation: row.explanation,
          source: row.source,
          checkedAt: row.checked_at,
          contentRevision: row.content_revision,
          addedAt: row.added_at,
          withdrawnAt: row.withdrawn_at,
        };
  }
}

/** One text per question content; jsonb does not keep the key order of an option. */
function contentOf(question: TrainerBankQuestion): string {
  return JSON.stringify([
    question.topic,
    question.format,
    question.text,
    question.options.map(({ text, correct, explanation }) => [
      text,
      correct,
      explanation,
    ]),
    question.explanation,
    question.source,
    question.checkedAt,
  ]);
}

/** Topics follow the file: its order and names; a topic the file dropped is hidden. */
async function writeTopics(
  tx: Database,
  bank: TrainerBankFile,
  now: Date,
): Promise<void> {
  await tx
    .insertInto("trainer_topics")
    .values(
      bank.topics.map(({ code, name }, position) => ({
        code,
        name,
        position,
        updated_at: now,
      })),
    )
    .onConflict((conflict) =>
      conflict.column("code").doUpdateSet((eb) => ({
        name: eb.ref("excluded.name"),
        position: eb.ref("excluded.position"),
        updated_at: eb.ref("excluded.updated_at"),
        withdrawn_at: null,
      })),
    )
    .execute();
  await tx
    .updateTable("trainer_topics")
    .set({ withdrawn_at: now, updated_at: now })
    .where("withdrawn_at", "is", null)
    .where(
      "code",
      "not in",
      bank.topics.map(({ code }) => code),
    )
    .execute();
}
