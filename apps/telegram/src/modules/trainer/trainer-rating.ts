import { sql } from "kysely";

import type { Database } from "../../database/database.js";
import type { VerifiedPrivateStart } from "../../shared/telegram-contact.js";
import { presentText } from "../../shared/text.js";
import { moscowWeekWindow, type TrainerTimeWindow } from "./trainer-days.js";
import { trainerPointsByPerson } from "./trainer-points.js";
import type { TrainerPerson } from "./trainer-rounds.js";
import {
  TRAINER_RATING_NAME_MAX_CHARS,
  TRAINER_RATING_ROWS_MAX,
} from "./widget/trainer-widget-limits.js";
import type { TrainerRatingData } from "./widget/trainer-widget-wire.js";

// The Rating of the Trainer: two tables of Points, «Неделя» and «Всё время». A table lists
// includes every person with points. Places are
// counted from the stored answers at the moment of the request; nothing here stores a place.

/** Rows from the top of a table; the viewer's own row may follow them. */
const TRAINER_RATING_TOP_ROWS = TRAINER_RATING_ROWS_MAX - 1;
/** Shown for a person whose Telegram name has no sign the table can show. */
const UNNAMED = "Без имени";

// Signs that break a one-line table row or cost more bytes than a character should: control
// characters, line separators, direction overrides and halves of a surrogate pair.
const unshowable = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\p{Bidi_Control}]/gu;

/**
 * A Telegram name as a Rating row shows it: one line of at most 24 characters. A character
 * takes at most four bytes, so eight rows of such names fit the 1 024 bytes of an answer.
 */
export function trainerRatingName(telegramName: string | null | undefined) {
  const line = (telegramName ?? "")
    .normalize("NFC")
    .replace(unshowable, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const name = [...line].slice(0, TRAINER_RATING_NAME_MAX_CHARS).join("");
  return presentText(name.trim()) ?? UNNAMED;
}

export class TrainerRating {
  constructor(private readonly database: Database) {}

  /** Keeps the latest name supplied by Telegram; missing names preserve the earlier observation. */
  async observe(contact: VerifiedPrivateStart): Promise<void> {
    const telegramName = contact.profile?.displayName;
    if (telegramName === undefined || telegramName === null) return;
    const profile = {
      display_name: trainerRatingName(telegramName),
      observed_at: contact.observedAt,
    };
    await this.database
      .insertInto("trainer_rating_profiles")
      .values({
        bot_identity: contact.botIdentity,
        telegram_user_id: contact.telegramUserId,
        ...profile,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["bot_identity", "telegram_user_id"])
          .doUpdateSet(profile)
          .where(
            "trainer_rating_profiles.observed_at",
            "<=",
            contact.observedAt,
          ),
      )
      .execute();
  }

  /**
   * The Rating screen of the week of this request or of all time: the first 7 rows and, for
   * a person with points below them, the person's own row.
   */
  async screen(
    contact: VerifiedPrivateStart,
    allTime: boolean,
  ): Promise<TrainerRatingData> {
    const rows = await this.database
      .selectFrom(
        this.table(
          contact.botIdentity,
          allTime ? {} : moscowWeekWindow(contact.observedAt),
        ).as("row"),
      )
      .select(["row.place", "row.name", "row.points", "row.telegram_user_id"])
      .where((eb) =>
        eb.or([
          eb("row.place", "<=", TRAINER_RATING_TOP_ROWS),
          eb("row.telegram_user_id", "=", contact.telegramUserId),
        ]),
      )
      .orderBy("row.place")
      .execute();
    return [
      "l",
      allTime ? 1 : 0,
      1,
      rows.map((row) => [
        row.place,
        row.name ?? UNNAMED,
        row.points,
        row.telegram_user_id === contact.telegramUserId ? 1 : 0,
      ]),
    ];
  }

  /**
   * The person's place in the table of the week of this instant; 0 for a person with no point this week.
   */
  async weekPlace(person: TrainerPerson, at: Date): Promise<number> {
    const row = await this.database
      .selectFrom(
        this.table(person.botIdentity, moscowWeekWindow(at)).as("row"),
      )
      .select("row.place")
      .where("row.telegram_user_id", "=", person.telegramUserId)
      .executeTakeFirst();
    return row?.place ?? 0;
  }

  /**
   * A whole table: every person with a point inside the window, each with a place of
   * their own. More points come first; of equal points, the person who got there earlier.
   */
  private table(botIdentity: string, window: TrainerTimeWindow) {
    return trainerPointsByPerson(this.database, botIdentity, window)
      .leftJoin("trainer_rating_profiles as profile", (join) =>
        join
          .onRef("profile.bot_identity", "=", "issue.bot_identity")
          .onRef("profile.telegram_user_id", "=", "issue.telegram_user_id"),
      )
      .groupBy("profile.display_name")
      .select([
        "profile.display_name as name",
        sql<number>`(row_number() over (
          order by count(*) desc, max(issue.completed_at), issue.telegram_user_id
        ))::integer`.as("place"),
      ]);
  }
}
