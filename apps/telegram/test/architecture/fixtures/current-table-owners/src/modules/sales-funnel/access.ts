// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("sales_funnel_event_outbox").selectAll().execute();
  await database.insertInto("sales_funnel_event_outbox").values({}).execute();
  await database.updateTable("sales_funnel_event_outbox").set({}).execute();
  await database.deleteFrom("sales_funnel_event_outbox").execute();
}
