// CLI fixture: raw community messages remain with the discussion module.
export async function access(database: any) {
  await database.selectFrom("community_messages").selectAll().execute();
  await database.insertInto("community_messages").values({}).execute();
  await database.updateTable("community_messages").set({}).execute();
  await database.deleteFrom("community_messages").execute();
}
