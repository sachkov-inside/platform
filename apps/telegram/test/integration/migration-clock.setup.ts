import { beforeAll, vi } from "vitest";

import { createDatabase } from "../../src/database/create-database.js";
import { migrateToLatest } from "../../src/database/migrator.js";
import { fixedTestInstant } from "../support/fixed-clock.js";
import { required } from "../support/required.js";

// Seed the shared ledger before a suite can register an advancing runtime Date.
// Rollback cases use registerFixedClock, so their replacement receipts share this instant.
beforeAll(async () => {
  const database = createDatabase(required(process.env["DATABASE_URL"]));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(fixedTestInstant());
  try {
    await migrateToLatest(database);
  } finally {
    vi.useRealTimers();
    await database.destroy();
  }
});
