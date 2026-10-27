import type { ColumnType } from "kysely";

export interface IdentityTables {
  telegram_identity_reservations: {
    bot_identity: string;
    telegram_user_id: string;
    identity_ref: string;
  };
  platform_link_profiles: {
    telegram_identity_ref: string;
    link_transaction_ref: string;
    display_name: string | null;
    username: string | null;
    search_text: string;
    observed_at: ColumnType<Date, Date | string, Date | string>;
  };
}
