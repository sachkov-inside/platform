// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("ai_models_openings").selectAll().execute();
  await database.insertInto("ai_models_openings").values({}).execute();
  await database.updateTable("ai_models_openings").set({}).execute();
  await database.deleteFrom("ai_models_openings").execute();
  await database.selectFrom("ai_models_references").selectAll().execute();
  await database.insertInto("ai_models_references").values({}).execute();
  await database.updateTable("ai_models_references").set({}).execute();
  await database.deleteFrom("ai_models_references").execute();
  await database.selectFrom("ai_models_card_views").selectAll().execute();
  await database.insertInto("ai_models_card_views").values({}).execute();
  await database.updateTable("ai_models_card_views").set({}).execute();
  await database.deleteFrom("ai_models_card_views").execute();
}
