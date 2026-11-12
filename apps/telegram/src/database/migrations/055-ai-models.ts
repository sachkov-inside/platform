import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// The ИИ-модели section: openings, revisions of the Справочник and opened model cards.
export const aiModelsMigration: Migration = {
  async up(db: Kysely<unknown>) {
    // One row per request to open the section, written before the widget is sent.
    // `source_code` is the label of a section link; null means the person came without one.
    // `delivery` is the fate of the widget message; `no_reference` means the Справочник was
    // not loaded yet, so the bot answered with a text and sent no widget.
    await sql`create table ai_models_openings (
      opening_id uuid primary key,
      bot_identity text not null,
      update_id bigint not null,
      telegram_user_id bigint not null,
      entry text not null check (entry in ('command', 'menu', 'link')),
      source_code text check (source_code ~ '^[A-Za-z0-9_-]{1,35}$'),
      opened_at timestamptz not null,
      delivery text not null check (delivery in
        ('sending', 'retry', 'delivered', 'rejected', 'unknown', 'no_reference')),
      provider_message_id bigint,
      unique (bot_identity, update_id)
    )`.execute(db);
    await sql`create index ai_models_openings_by_day
      on ai_models_openings (bot_identity, opened_at)`.execute(db);
    await sql`create index ai_models_openings_by_contact
      on ai_models_openings (bot_identity, telegram_user_id)`.execute(db);

    // Every imported Справочник, kept as history; the highest revision is the current one.
    // The author's opinion is stored apart from the facts.
    await sql`create table ai_models_references (
      revision integer primary key check (revision > 0),
      checked_on date not null,
      facts jsonb not null check (jsonb_typeof(facts) = 'object'),
      author jsonb not null check (jsonb_typeof(author) = 'object'),
      content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
      imported_at timestamptz not null
    )`.execute(db);

    // One row per opened tab «Главное» of a model card. `model_code` follows
    // AI_MODELS_CODE_PATTERN (modules/ai-models/widget/ai-models-widget-request.ts), which owns
    // the format; the check repeats it because a migration stays as it was released.
    await sql`create table ai_models_card_views (
      id bigint generated always as identity primary key,
      bot_identity text not null,
      telegram_user_id bigint not null,
      model_code text not null check (model_code ~ '^[a-z0-9][a-z0-9-]{0,15}$'),
      viewed_at timestamptz not null
    )`.execute(db);
    await sql`create index ai_models_card_views_by_day
      on ai_models_card_views (bot_identity, viewed_at)`.execute(db);
  },
  async down(db: Kysely<unknown>) {
    await sql`drop table ai_models_card_views`.execute(db);
    await sql`drop table ai_models_references`.execute(db);
    await sql`drop table ai_models_openings`.execute(db);
  },
};
