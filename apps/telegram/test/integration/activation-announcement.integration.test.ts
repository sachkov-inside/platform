import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../../src/database/create-database.js";
import { PostgresAnnouncementDeliveries } from "../../src/modules/subscription-activation/announcement-deliveries.js";
import { required } from "../support/required.js";
const db = createDatabase(required(process.env["DATABASE_URL"]));
afterAll(async () => {
  await db.destroy();
});
describe("private announcement durable duplicate protection", () => {
  it("claims a concurrent operation once and blocks replay after an unknown send", async () => {
    const deliveries = new PostgresAnnouncementDeliveries(db);
    const id = randomUUID();
    const fingerprint = randomUUID();
    const results = await Promise.all([
      deliveries.claim(id, fingerprint),
      deliveries.claim(id, fingerprint),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await deliveries.complete(id, "unknown");
    expect(
      await new PostgresAnnouncementDeliveries(db).claim(id, fingerprint),
    ).toBe(false);
    expect(await deliveries.claim(randomUUID(), fingerprint)).toBe(false);
    expect(await deliveries.claim(id, randomUUID())).toBe(false);
  });
});
