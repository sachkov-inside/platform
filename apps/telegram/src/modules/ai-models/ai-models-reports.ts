import { sql } from "kysely";

import type { Database } from "../../database/database.js";

/** The label the usage report gives to openings that came without a source label. */
export const AI_MODELS_UNKNOWN_SOURCE = "неизвестна";

/** Openings of one Moscow day that came with one source label. */
export interface AiModelsUsageSourceLine {
  /** The label of the section link, or AI_MODELS_UNKNOWN_SOURCE. */
  readonly source: string;
  readonly openings: number;
  /** People who opened the section with this label on this day. */
  readonly people: number;
}

/** One Moscow day on which somebody opened the section. */
export interface AiModelsUsageReportLine {
  /** The Moscow calendar day, `YYYY-MM-DD`. */
  readonly day: string;
  readonly openings: number;
  /** People who opened the section on this day. */
  readonly people: number;
  /** A person who came with two labels on one day counts under both. */
  readonly sources: readonly AiModelsUsageSourceLine[];
}

/** Views of one model card. */
export interface AiModelsCardViews {
  /**
   * Person-days with an opened tab «Главное»: a repeated open by the same person on the same
   * Moscow day does not count again.
   */
  readonly views: number;
  /** People who opened the card. */
  readonly people: number;
}

/** One model whose card somebody opened, with its views over all time and over the last week. */
export interface AiModelsCardsReportLine extends AiModelsCardViews {
  /** The model's code in the Справочник. */
  readonly model: string;
  /** Views on the last seven Moscow days, today included. */
  readonly last7Days: AiModelsCardViews;
}

/** The calendar day of a stored instant in Moscow. */
const moscowDay = (column: string) =>
  sql<string>`to_char(${sql.ref(column)} at time zone 'Europe/Moscow', 'YYYY-MM-DD')`;

/**
 * The author's reports on ИИ-модели. They count people and never name them: no line carries a
 * name or a Telegram identifier.
 */
export class AiModelsReports {
  constructor(private readonly db: Database) {}

  /**
   * Every Moscow day with an opening, oldest first. Each request to open the section is an
   * opening, whatever became of it: a widget Telegram did not deliver counts, and so does a
   * request answered with a text before the first Справочник was loaded. Within a day the labels
   * go in alphabetical order and the openings without a label go last.
   */
  async usage(): Promise<AiModelsUsageReportLine[]> {
    const sources = await sql<{
      day: string;
      source: string | null;
      openings: number;
      people: number;
    }>`
      select
        ${moscowDay("opened_at")} as day,
        source_code as source,
        count(*)::int as openings,
        count(distinct (bot_identity, telegram_user_id))::int as people
      from ai_models_openings
      group by 1, 2
      order by 1, 2 nulls last
    `.execute(this.db);
    const days = await sql<{ day: string; openings: number; people: number }>`
      select
        ${moscowDay("opened_at")} as day,
        count(*)::int as openings,
        count(distinct (bot_identity, telegram_user_id))::int as people
      from ai_models_openings
      group by 1
      order by 1
    `.execute(this.db);
    return days.rows.map((day) => ({
      ...day,
      sources: sources.rows
        .filter((source) => source.day === day.day)
        .map(({ source, openings, people }) => ({
          source: source ?? AI_MODELS_UNKNOWN_SOURCE,
          openings,
          people,
        })),
    }));
  }

  /**
   * Every model whose card somebody opened, a model no longer in the Справочник included. The
   * most viewed card goes first; equal views go by people, then by model code. A stored view is
   * already one person on one Moscow day, so each row counts once.
   */
  async cards(now: Date): Promise<AiModelsCardsReportLine[]> {
    const rows = await sql<{
      model: string;
      views: number;
      people: number;
      week_views: number;
      week_people: number;
    }>`
      with card_view as (
        select
          *,
          viewed_on >= (${now}::timestamptz at time zone 'Europe/Moscow')::date - 6
            as this_week
        from ai_models_card_views
      )
      select
        model_code as model,
        count(*)::int as views,
        count(distinct (bot_identity, telegram_user_id))::int as people,
        count(*) filter (where this_week)::int as week_views,
        count(distinct (bot_identity, telegram_user_id))
          filter (where this_week)::int as week_people
      from card_view
      group by model_code
      order by views desc, people desc, model_code
    `.execute(this.db);
    return rows.rows.map((row) => ({
      model: row.model,
      views: row.views,
      people: row.people,
      last7Days: { views: row.week_views, people: row.week_people },
    }));
  }
}
