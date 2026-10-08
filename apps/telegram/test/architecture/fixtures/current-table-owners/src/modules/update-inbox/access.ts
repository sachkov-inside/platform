// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("telegram_updates").selectAll().execute();
  await database.insertInto("telegram_updates").values({}).execute();
  await database.updateTable("telegram_updates").set({}).execute();
  await database.deleteFrom("telegram_updates").execute();
}
