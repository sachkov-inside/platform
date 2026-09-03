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
      testDatabase.prisma.membershipBinding.count(),
      testDatabase.prisma.membershipEvidenceReceipt.count(),
      testDatabase.prisma.membershipProjection.count(),
      testDatabase.prisma.topic.count(),
      testDatabase.prisma.format.count(),
      testDatabase.prisma.tag.count(),
      testDatabase.prisma.series.count(),
      testDatabase.prisma.material.count(),
      testDatabase.prisma.materialRelatedPin.count(),
      testDatabase.prisma.materialTag.count(),
      testDatabase.prisma.seriesMembership.count(),
      testDatabase.prisma.authoringIdempotency.count(),
      testDatabase.prisma.publishedMaterial.count(),
      testDatabase.prisma.publishedMaterialTag.count(),
      testDatabase.prisma.publishedMaterialSeriesMembership.count(),
      testDatabase.prisma.materialSearchDocument.count(),
      testDatabase.prisma.video.count(),
      testDatabase.prisma.videoUploadAttempt.count(),
      testDatabase.prisma.videoWebhookInbox.count(),
      testDatabase.prisma.videoPlaybackProgress.count(),
      testDatabase.prisma.videoDeletionOperation.count(),
      testDatabase.prisma.workshopEntitlement.count(),
      testDatabase.prisma.workshopCase.count(),
      testDatabase.prisma.workshopCaseVersion.count(),
      testDatabase.prisma.workshopCaseMaterial.count(),
      testDatabase.prisma.workshopHintReveal.count(),
      testDatabase.prisma.workshopSolutionReveal.count(),
    ]);

    expect(counts).toEqual(Array.from({ length: 30 }, () => 0));
  });
});
