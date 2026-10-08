// CLI fixture: literal reads and writes remain with their table owner.
export async function access(database: any) {
  await database.selectFrom("membership_check_results").selectAll().execute();
  await database.insertInto("membership_check_results").values({}).execute();
  await database.updateTable("membership_check_results").set({}).execute();
  await database.deleteFrom("membership_check_results").execute();
  await database.selectFrom("membership_checks").selectAll().execute();
  await database.insertInto("membership_checks").values({}).execute();
  await database.updateTable("membership_checks").set({}).execute();
  await database.deleteFrom("membership_checks").execute();
  await database.selectFrom("membership_event_audit").selectAll().execute();
  await database.insertInto("membership_event_audit").values({}).execute();
  await database.updateTable("membership_event_audit").set({}).execute();
  await database.deleteFrom("membership_event_audit").execute();
  await database.selectFrom("membership_evidence_outbox").selectAll().execute();
  await database.insertInto("membership_evidence_outbox").values({}).execute();
  await database.updateTable("membership_evidence_outbox").set({}).execute();
  await database.deleteFrom("membership_evidence_outbox").execute();
  await database.selectFrom("membership_provider_observations").selectAll().execute();
  await database.insertInto("membership_provider_observations").values({}).execute();
  await database.updateTable("membership_provider_observations").set({}).execute();
  await database.deleteFrom("membership_provider_observations").execute();
  await database.selectFrom("membership_provider_state").selectAll().execute();
  await database.insertInto("membership_provider_state").values({}).execute();
  await database.updateTable("membership_provider_state").set({}).execute();
  await database.deleteFrom("membership_provider_state").execute();
  await database.selectFrom("membership_reconciliations").selectAll().execute();
  await database.insertInto("membership_reconciliations").values({}).execute();
  await database.updateTable("membership_reconciliations").set({}).execute();
  await database.deleteFrom("membership_reconciliations").execute();
}
