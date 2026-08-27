import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("Prisma schema", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("maps every table created by the checked-in migration", async () => {
    const counts = await Promise.all([
      testDatabase.prisma.account.count(),
      testDatabase.prisma.accountPermission.count(),
      testDatabase.prisma.accountAuditEvent.count(),
      testDatabase.prisma.topic.count(),
      testDatabase.prisma.format.count(),
      testDatabase.prisma.tag.count(),
      testDatabase.prisma.series.count(),
      testDatabase.prisma.material.count(),
      testDatabase.prisma.materialTag.count(),
      testDatabase.prisma.seriesMembership.count(),
      testDatabase.prisma.authoringIdempotency.count(),
      testDatabase.prisma.publishedMaterial.count(),
      testDatabase.prisma.publishedMaterialTag.count(),
      testDatabase.prisma.publishedMaterialSeriesMembership.count(),
      testDatabase.prisma.materialSearchDocument.count(),
      testDatabase.prisma.materialAccessAuditEvent.count(),
    ]);

    expect(counts).toEqual(Array.from({ length: 16 }, () => 0));
  });
});
