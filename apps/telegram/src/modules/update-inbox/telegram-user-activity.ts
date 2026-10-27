import { Inject, Injectable } from "@nestjs/common";
import { sql } from "kysely";
import {
  TELEGRAM_ACTIVITY_RETENTION_MS,
  TELEGRAM_ACTIVITY_ROW_LIMIT,
  telegramActivityWindowSchema,
  telegramActivityResultSchema,
  type TelegramActivityResult,
} from "@inside/contracts/telegram-activity";
import { DATABASE, type Database } from "../../database/database.js";
import {
  APPLICATION_CONFIG,
  type ApplicationConfig,
} from "../../config/application-config.js";
import { currentActivityAccount } from "../identity-linking/platform-links.js";

export type ConfirmedTelegramActionKind =
  | "marketing_preference"
  | "marketing_entry"
  | "template_saved"
  | "sign_in_decision";
export interface ConfirmedTelegramAction {
  readonly telegramUserId: string;
  readonly kind: ConfirmedTelegramActionKind;
}

/** Only the Telegram owner reads facts; link projection is evaluated at the report snapshot. */
@Injectable()
export class TelegramUserActivity {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APPLICATION_CONFIG) private readonly config: ApplicationConfig,
  ) {}

  async read(input: unknown): Promise<TelegramActivityResult> {
    const parsed = telegramActivityWindowSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request" } };
    try {
      return await this.database
        .transaction()
        .setIsolationLevel("repeatable read")
        .execute(async (tx) => {
          await sql`set transaction read only`.execute(tx);
          await sql`set local statement_timeout = '2000ms'`.execute(tx);
          await sql`set local lock_timeout = '500ms'`.execute(tx);
          const clock = await sql<{
            as_of: Date;
            started_at: Date;
          }>`select transaction_timestamp() as as_of, started_at from telegram_activity_collection where singleton`.execute(
            tx,
          );
          const at = clock.rows[0];
          if (!at) return { ok: false, error: { code: "source_unavailable" } };
          const from = new Date(parsed.data.from),
            to = new Date(parsed.data.to);
          const retentionFrom = new Date(
            at.as_of.getTime() - TELEGRAM_ACTIVITY_RETENTION_MS,
          );
          if (from < retentionFrom)
            return { ok: false, error: { code: "outside_retention" } };
          if (to <= at.started_at)
            return { ok: false, error: { code: "outside_collection" } };
          if (to > at.as_of)
            return { ok: false, error: { code: "invalid_request" } };
          const rows = await tx
            .selectFrom("telegram_user_activity")
            .select("telegram_user_id")
            .select(
              currentActivityAccount(
                tx,
                "telegram_user_activity.bot_identity",
                "telegram_user_activity.telegram_user_id",
              ).as("account_id"),
            )
            .where("bot_identity", "=", this.config.botIdentity)
            .where("occurred_at", ">=", from)
            .where("occurred_at", "<", to)
            .groupBy(["bot_identity", "telegram_user_id"])
            .limit(TELEGRAM_ACTIVITY_ROW_LIMIT + 1)
            .execute();
          if (rows.length > TELEGRAM_ACTIVITY_ROW_LIMIT)
            return { ok: false, error: { code: "source_budget_exceeded" } };
          return telegramActivityResultSchema.parse({
            ok: true,
            value: {
              contractVersion: "inside.telegram-activity.v1",
              window: { from: from.toISOString(), to: to.toISOString() },
              asOf: at.as_of.toISOString(),
              coverage: {
                status: "partial",
                collectionStartedAt: at.started_at.toISOString(),
                continuity: "not_proven",
                retentionFrom: retentionFrom.toISOString(),
              },
              attribution: "current_confirmed_link",
              accountIds: [
                ...new Set(
                  rows.flatMap((row) =>
                    row.account_id === null ? [] : [row.account_id],
                  ),
                ),
              ],
              unlinkedContacts: rows.filter((row) => row.account_id === null)
                .length,
            },
          });
        });
    } catch {
      return { ok: false, error: { code: "source_unavailable" } };
    }
  }
}
