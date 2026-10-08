// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("notification_attempts").selectAll().execute();
  await database.insertInto("notification_attempts").values({}).execute();
  await database.updateTable("notification_attempts").set({}).execute();
  await database.deleteFrom("notification_attempts").execute();
  await database.selectFrom("notification_commands").selectAll().execute();
  await database.insertInto("notification_commands").values({}).execute();
  await database.updateTable("notification_commands").set({}).execute();
  await database.deleteFrom("notification_commands").execute();
  await database.selectFrom("notification_deliveries").selectAll().execute();
  await database.insertInto("notification_deliveries").values({}).execute();
  await database.updateTable("notification_deliveries").set({}).execute();
  await database.deleteFrom("notification_deliveries").execute();
  await database.selectFrom("notification_quarantine").selectAll().execute();
  await database.insertInto("notification_quarantine").values({}).execute();
  await database.updateTable("notification_quarantine").set({}).execute();
  await database.deleteFrom("notification_quarantine").execute();
  await database.selectFrom("notification_result_outbox").selectAll().execute();
  await database.insertInto("notification_result_outbox").values({}).execute();
  await database.updateTable("notification_result_outbox").set({}).execute();
  await database.deleteFrom("notification_result_outbox").execute();
}
