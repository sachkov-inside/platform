import type { ColumnType } from "kysely";
type Timestamp = ColumnType<Date, Date, Date>;
export interface TransportTables {
  telegram_transport_fairness: {
    bot_identity: string;
    cursor: number;
    general_waiting_until: Timestamp;
    subscription_waiting_until: Timestamp;
    material_waiting_until: Timestamp;
  };
}
