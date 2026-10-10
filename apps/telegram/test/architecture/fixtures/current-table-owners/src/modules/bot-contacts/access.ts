// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("bot_contact_events").selectAll().execute();
  await database.insertInto("bot_contact_events").values({}).execute();
  await database.updateTable("bot_contact_events").set({}).execute();
  await database.deleteFrom("bot_contact_events").execute();
  await database.selectFrom("bot_contacts").selectAll().execute();
  await database.insertInto("bot_contacts").values({}).execute();
  await database.updateTable("bot_contacts").set({}).execute();
  await database.deleteFrom("bot_contacts").execute();
}
