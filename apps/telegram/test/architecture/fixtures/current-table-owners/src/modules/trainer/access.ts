// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("trainer_questions").selectAll().execute();
  await database.insertInto("trainer_questions").values({}).execute();
  await database.updateTable("trainer_questions").set({}).execute();
  await database.deleteFrom("trainer_questions").execute();
  await database.selectFrom("trainer_topics").selectAll().execute();
  await database.insertInto("trainer_topics").values({}).execute();
  await database.updateTable("trainer_topics").set({}).execute();
  await database.deleteFrom("trainer_topics").execute();
}
