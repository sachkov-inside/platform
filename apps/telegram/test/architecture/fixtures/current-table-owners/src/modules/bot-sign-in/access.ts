// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("sign_in_requests").selectAll().execute();
  await database.insertInto("sign_in_requests").values({}).execute();
  await database.updateTable("sign_in_requests").set({}).execute();
  await database.deleteFrom("sign_in_requests").execute();
  await database.selectFrom("sign_in_subjects").selectAll().execute();
  await database.insertInto("sign_in_subjects").values({}).execute();
  await database.updateTable("sign_in_subjects").set({}).execute();
  await database.deleteFrom("sign_in_subjects").execute();
}
