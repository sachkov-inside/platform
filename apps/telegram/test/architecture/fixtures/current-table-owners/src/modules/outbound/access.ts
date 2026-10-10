// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("start_response_deliveries").selectAll().execute();
  await database.insertInto("start_response_deliveries").values({}).execute();
  await database.updateTable("start_response_deliveries").set({}).execute();
  await database.deleteFrom("start_response_deliveries").execute();
  await database.selectFrom("start_response_delivery_attempts").selectAll().execute();
  await database.insertInto("start_response_delivery_attempts").values({}).execute();
  await database.updateTable("start_response_delivery_attempts").set({}).execute();
  await database.deleteFrom("start_response_delivery_attempts").execute();
  await database.selectFrom("telegram_transport_fairness").selectAll().execute();
  await database.insertInto("telegram_transport_fairness").values({}).execute();
  await database.updateTable("telegram_transport_fairness").set({}).execute();
  await database.deleteFrom("telegram_transport_fairness").execute();
  await database.selectFrom("telegram_transport_slots").selectAll().execute();
  await database.insertInto("telegram_transport_slots").values({}).execute();
  await database.updateTable("telegram_transport_slots").set({}).execute();
  await database.deleteFrom("telegram_transport_slots").execute();
}
