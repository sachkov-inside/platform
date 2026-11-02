// CLI fixture: raw community messages remain with the discussion module.
export async function access(database: any) {
  await database.selectFrom("community_messages").selectAll().execute();
  await database.insertInto("community_messages").values({}).execute();
  await database.updateTable("community_messages").set({}).execute();
  await database.deleteFrom("community_messages").execute();
  await database.selectFrom("community_discussions").selectAll().execute();
  await database.insertInto("community_discussions").values({}).execute();
  await database.updateTable("community_discussions").set({}).execute();
  await database.deleteFrom("community_discussions").execute();
  await database.selectFrom("community_discussion_sources").selectAll().execute();
  await database.insertInto("community_discussion_sources").values({}).execute();
  await database.updateTable("community_discussion_sources").set({}).execute();
  await database.deleteFrom("community_discussion_sources").execute();
  await database.selectFrom("community_discussion_schedule").selectAll().execute();
  await database.insertInto("community_discussion_schedule").values({}).execute();
  await database.updateTable("community_discussion_schedule").set({}).execute();
  await database.deleteFrom("community_discussion_schedule").execute();
  await database.selectFrom("community_discussion_mark_receipts").selectAll().execute();
  await database.insertInto("community_discussion_mark_receipts").values({}).execute();
  await database.updateTable("community_discussion_mark_receipts").set({}).execute();
  await database.deleteFrom("community_discussion_mark_receipts").execute();
}
