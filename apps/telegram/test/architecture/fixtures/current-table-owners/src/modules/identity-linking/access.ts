// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("identity_link_events").selectAll().execute();
  await database.insertInto("identity_link_events").values({}).execute();
  await database.updateTable("identity_link_events").set({}).execute();
  await database.deleteFrom("identity_link_events").execute();
  await database.selectFrom("identity_link_recoveries").selectAll().execute();
  await database.insertInto("identity_link_recoveries").values({}).execute();
  await database.updateTable("identity_link_recoveries").set({}).execute();
  await database.deleteFrom("identity_link_recoveries").execute();
  await database.selectFrom("link_transactions").selectAll().execute();
  await database.insertInto("link_transactions").values({}).execute();
  await database.updateTable("link_transactions").set({}).execute();
  await database.deleteFrom("link_transactions").execute();
  await database.selectFrom("platform_links").selectAll().execute();
  await database.insertInto("platform_links").values({}).execute();
  await database.updateTable("platform_links").set({}).execute();
  await database.deleteFrom("platform_links").execute();
  await database.selectFrom("telegram_identity_reservations").selectAll().execute();
  await database.insertInto("telegram_identity_reservations").values({}).execute();
  await database.updateTable("telegram_identity_reservations").set({}).execute();
  await database.deleteFrom("telegram_identity_reservations").execute();
}
