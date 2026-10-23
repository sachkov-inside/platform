import { sql } from "kysely";
import type { Database } from "../../database/database.js";
import type { AnnouncementDeliveries } from "./activation-announcement.js";

/** The database claim precedes the provider call; even a lost result blocks another send. */
export class PostgresAnnouncementDeliveries implements AnnouncementDeliveries {
  constructor(private readonly db: Database) {}
  async claim(operationId: string, fingerprint: string): Promise<boolean> {
    const result = await sql`insert into activation_announcement_deliveries
      (operation_id, fingerprint, status) values (${operationId}, ${fingerprint}, 'pending')
      on conflict do nothing returning operation_id`.execute(this.db);
    return result.rows.length === 1;
  }
  async complete(
    operationId: string,
    status: "sent" | "not_sent" | "unknown",
  ): Promise<void> {
    await sql`update activation_announcement_deliveries set status = ${status}
      where operation_id = ${operationId}`.execute(this.db);
  }
}
