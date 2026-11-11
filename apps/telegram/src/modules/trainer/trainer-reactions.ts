import type { Database } from "../../database/database.js";
import type { VerifiedPrivateStart } from "../../shared/telegram-contact.js";
import { issueNumber, type TrainerPerson } from "./trainer-rounds.js";
import type { TrainerReaction } from "./widget/trainer-widget-wire.js";

/** One current opinion per person and question, shared by all rounds and modes. */
export class TrainerReactions {
  constructor(private readonly database: Database) {}

  async of(
    person: TrainerPerson,
    questionId: string,
  ): Promise<TrainerReaction> {
    const row = await this.database
      .selectFrom("trainer_question_reactions")
      .select("reaction")
      .where("bot_identity", "=", person.botIdentity)
      .where("telegram_user_id", "=", person.telegramUserId)
      .where("question_id", "=", questionId)
      .executeTakeFirst();
    return row?.reaction ?? 0;
  }

  /** Only an issue the sender has already answered can identify a question for a reaction. */
  async set(
    contact: VerifiedPrivateStart,
    issueId: string,
    reaction: TrainerReaction,
  ): Promise<TrainerReaction | undefined> {
    const id = issueNumber(issueId);
    if (id === undefined) return undefined;
    return this.database.transaction().execute(async (tx) => {
      const issue = await tx
        .selectFrom("trainer_issues")
        .select("question_id")
        .where("id", "=", id)
        .where("bot_identity", "=", contact.botIdentity)
        .where("telegram_user_id", "=", contact.telegramUserId)
        .where("answered_at", "is not", null)
        .executeTakeFirst();
      if (!issue) return undefined;
      await tx
        .insertInto("trainer_question_reactions")
        .values({
          bot_identity: contact.botIdentity,
          telegram_user_id: contact.telegramUserId,
          question_id: issue.question_id,
          reaction,
          observed_at: contact.observedAt,
        })
        .onConflict((conflict) =>
          conflict
            .columns(["bot_identity", "telegram_user_id", "question_id"])
            .doUpdateSet({ reaction, observed_at: contact.observedAt })
            .where(
              "trainer_question_reactions.observed_at",
              "<=",
              contact.observedAt,
            ),
        )
        .execute();
      // Zero stays as a tombstone, so a delayed earlier vote cannot undo a removal.
      const stored = await tx
        .selectFrom("trainer_question_reactions")
        .select("reaction")
        .where("bot_identity", "=", contact.botIdentity)
        .where("telegram_user_id", "=", contact.telegramUserId)
        .where("question_id", "=", issue.question_id)
        .executeTakeFirstOrThrow();
      return stored.reaction;
    });
  }
}
