// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("activation_attempts").selectAll().execute();
  await database.insertInto("activation_attempts").values({}).execute();
  await database.updateTable("activation_attempts").set({}).execute();
  await database.deleteFrom("activation_attempts").execute();
  await database.selectFrom("activation_review_requests").selectAll().execute();
  await database.insertInto("activation_review_requests").values({}).execute();
  await database.updateTable("activation_review_requests").set({}).execute();
  await database.deleteFrom("activation_review_requests").execute();
  await database.selectFrom("invitation_redemptions").selectAll().execute();
  await database.insertInto("invitation_redemptions").values({}).execute();
  await database.updateTable("invitation_redemptions").set({}).execute();
  await database.deleteFrom("invitation_redemptions").execute();
}
