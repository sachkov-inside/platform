// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("trainer_openings").selectAll().execute();
  await database.insertInto("trainer_openings").values({}).execute();
  await database.updateTable("trainer_openings").set({}).execute();
  await database.deleteFrom("trainer_openings").execute();
}
