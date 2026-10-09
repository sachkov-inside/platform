// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("community_bindings").selectAll().execute();
  await database.insertInto("community_bindings").values({}).execute();
  await database.updateTable("community_bindings").set({}).execute();
  await database.deleteFrom("community_bindings").execute();
  await database.selectFrom("community_desired_states").selectAll().execute();
  await database.insertInto("community_desired_states").values({}).execute();
  await database.updateTable("community_desired_states").set({}).execute();
  await database.deleteFrom("community_desired_states").execute();
  await database.selectFrom("community_effect_attempts").selectAll().execute();
  await database.insertInto("community_effect_attempts").values({}).execute();
  await database.updateTable("community_effect_attempts").set({}).execute();
  await database.deleteFrom("community_effect_attempts").execute();
  await database.selectFrom("community_effects").selectAll().execute();
  await database.insertInto("community_effects").values({}).execute();
  await database.updateTable("community_effects").set({}).execute();
  await database.deleteFrom("community_effects").execute();
  await database.selectFrom("community_operations").selectAll().execute();
  await database.insertInto("community_operations").values({}).execute();
  await database.updateTable("community_operations").set({}).execute();
  await database.deleteFrom("community_operations").execute();
  await database.selectFrom("community_restriction_decisions").selectAll().execute();
  await database.insertInto("community_restriction_decisions").values({}).execute();
  await database.updateTable("community_restriction_decisions").set({}).execute();
  await database.deleteFrom("community_restriction_decisions").execute();
}
