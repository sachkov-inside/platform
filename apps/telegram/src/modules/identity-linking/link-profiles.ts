import { Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import {
  DATABASE,
  type Database,
  type DatabaseSchema,
} from "../../database/database.js";
import type { TelegramUserProfile } from "../../shared/telegram-contact.js";

type Executor = Database | Transaction<DatabaseSchema>;

/** One observed profile of a bot's Telegram user. */
export interface LinkProfileObservation extends TelegramUserProfile {
  readonly telegramUserId: string;
  /** Stores the profile only while this confirmation is still the current link. */
  readonly linkTransactionRef?: string;
}

export interface LinkProfileMatch {
  readonly accountRef: string;
  readonly telegramIdentityRef: string;
  readonly displayName: string | null;
  readonly username: string | null;
}

/**
 * Stores the name and username of current links only. A user without a link is not stored, and
 * an observation older than the stored one of the same link is ignored. Each matched link is
 * share-locked, so a concurrent transfer either deletes the row after this write or makes it skip.
 */
export async function observeLinkProfiles(
  database: Executor,
  botIdentity: string,
  observedAt: Date,
  observations: readonly LinkProfileObservation[],
): Promise<void> {
  // One row per user: an upsert cannot touch the same row twice in one statement.
  const unique = [
    ...new Map(
      observations.map((observation) => [
        observation.telegramUserId,
        observation,
      ]),
    ).values(),
  ];
  if (unique.length === 0) return;
  await sql`
    insert into platform_link_profiles as stored (
      telegram_identity_ref, link_transaction_ref, display_name, username, search_text, observed_at
    )
    select links.telegram_identity_ref, links.link_transaction_ref,
      observed.display_name, observed.username, observed.search_text, ${observedAt}
    from unnest(
      ${unique.map((item) => item.telegramUserId)}::bigint[],
      ${unique.map((item) => item.linkTransactionRef ?? null)}::text[],
      ${unique.map((item) => item.displayName)}::text[],
      ${unique.map((item) => item.username)}::text[],
      ${unique.map((item) => linkProfileSearchText(item))}::text[]
    ) as observed(telegram_user_id, link_transaction_ref, display_name, username, search_text)
    join platform_links links
      on links.bot_identity = ${botIdentity}
      and links.telegram_user_id = observed.telegram_user_id
      and (observed.link_transaction_ref is null
        or links.link_transaction_ref = observed.link_transaction_ref)
    for share of links
    on conflict (telegram_identity_ref) do update set
      link_transaction_ref = excluded.link_transaction_ref,
      display_name = excluded.display_name,
      username = excluded.username,
      search_text = excluded.search_text,
      observed_at = excluded.observed_at
    where stored.link_transaction_ref <> excluded.link_transaction_ref
      or stored.observed_at <= excluded.observed_at
  `.execute(database);
}

/** Removes the stored profile of a link that is transferred in the caller's transaction. */
export async function deleteLinkProfile(
  transaction: Transaction<DatabaseSchema>,
  telegramIdentityRef: string,
): Promise<void> {
  await transaction
    .deleteFrom("platform_link_profiles")
    .where("telegram_identity_ref", "=", telegramIdentityRef)
    .execute();
}

/**
 * Case-insensitive substring search over stored profiles of the bot's current links. The match
 * and the current-link check are one statement; a profile of an earlier confirmation never matches.
 */
export async function searchLinkProfiles(
  database: Executor,
  botIdentity: string,
  query: string,
  limit: number,
): Promise<{
  readonly matches: readonly LinkProfileMatch[];
  readonly truncated: boolean;
}> {
  const rows = await database
    .selectFrom("platform_link_profiles as profiles")
    .innerJoin("platform_links as links", (join) =>
      join
        .onRef(
          "links.telegram_identity_ref",
          "=",
          "profiles.telegram_identity_ref",
        )
        .onRef(
          "links.link_transaction_ref",
          "=",
          "profiles.link_transaction_ref",
        ),
    )
    .select([
      "links.account_ref",
      "links.telegram_identity_ref",
      "profiles.display_name",
      "profiles.username",
    ])
    .where("links.bot_identity", "=", botIdentity)
    .where(
      sql<boolean>`profiles.search_text like ${`%${escapeLike(searchForm(query))}%`} escape '\\'`,
    )
    .orderBy("profiles.search_text")
    .orderBy("links.telegram_identity_ref")
    .limit(limit + 1)
    .execute();
  return {
    matches: rows.slice(0, limit).map((row) => ({
      accountRef: row.account_ref,
      telegramIdentityRef: row.telegram_identity_ref,
      displayName: row.display_name,
      username: row.username,
    })),
    truncated: rows.length > limit,
  };
}

/** Search form of a stored profile; a newline separates the name from the username. */
function linkProfileSearchText(profile: TelegramUserProfile): string {
  return [profile.displayName, profile.username]
    .filter((part) => part !== null)
    .map(searchForm)
    .join("\n");
}

/** Locale-independent case folding, computed here rather than by the database collation. */
function searchForm(value: string): string {
  return value.normalize("NFKC").toLowerCase().replaceAll("ё", "е");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

/** Stores sender profiles from private updates of linked users. */
@Injectable()
export class LinkProfiles {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
  ) {}

  async observe(sender: {
    readonly botIdentity: string;
    readonly telegramUserId: string;
    readonly observedAt: Date;
    readonly profile?: TelegramUserProfile;
  }): Promise<void> {
    if (
      sender.profile === undefined ||
      sender.botIdentity !== this.config.botIdentity
    )
      return;
    await observeLinkProfiles(
      this.database,
      sender.botIdentity,
      sender.observedAt,
      [{ telegramUserId: sender.telegramUserId, ...sender.profile }],
    );
  }

  search(query: string, limit: number) {
    return searchLinkProfiles(
      this.database,
      this.config.botIdentity,
      query,
      limit,
    );
  }
}
