import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { composeTelegramLinks } from "../../src/entrypoints/composition/telegram-links.js";
import {
  accountId as checkedAccountId,
  assembleAccounts,
} from "../../src/modules/accounts/index.js";
import {
  assembleContentAccess,
  assembleCurrentAccountPermissions,
  assembleDeterministicAccountRights,
  type MaterialResourceFacts,
} from "../../src/modules/content-access/index.js";
import { materialId } from "../../src/modules/materials/domain/material-identifiers.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";

import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const accountId = checkedAccountId("83100000-0000-4000-8000-000000000001");
const lesson: MaterialResourceFacts = {
  materialId: materialId("83100000-0000-4000-8000-000000000002"),
  publicationState: "published",
  access: "free",
  contentVersion: 3,
  primaryVideoId: null,
  productIds: ["83100000-0000-4000-8000-000000000003"],
};

describe("free Product lesson and the stored Telegram link (#1825)", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await testDatabase.prisma.account.create({
      data: {
        id: accountId,
        logtoIssuer: "https://identity.example.test/oidc",
        logtoSubject: "free-lesson-reader",
      },
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("opens the lesson once the link is confirmed and closes it after unlinking", async () => {
    const contentAccess = assembleContentAccess({
      materialResourceFacts: {
        findMany: () => Promise.resolve([lesson]),
        findOne: () => Promise.resolve(lesson),
      },
      accountPermissions: assembleCurrentAccountPermissions(
        assembleAccounts({
          prisma: testDatabase.prisma,
          emailFingerprintKey: "free-lesson-test-fingerprint-key",
        }),
      ),
      accountRights: assembleDeterministicAccountRights(),
      telegramLinks: composeTelegramLinks(
        new TelegramAccountLinks(testDatabase.prisma),
      ),
    });
    const read = () =>
      contentAccess.authorize({
        subject: { kind: "account", accountId },
        resource: { kind: "material", materialId: lesson.materialId },
        action: "read",
        enforcementPoint: "published_material_read",
        correlationId: randomUUID(),
      });

    await expect(read()).resolves.toMatchObject({
      effect: "deny",
      reason: "telegram_link_required",
    });

    const linkRef = randomUUID();
    // deterministic-test-allow wall-clock: only the link ordering columns use it.
    const now = new Date();
    await testDatabase.prisma.telegramLinkTransaction.create({
      data: {
        linkRef,
        accountId,
        principalRef: randomUUID(),
        providerIdentityRef: "telegram-identity-free-lesson",
        providerTransactionRef: randomUUID(),
        returnCorrelation: randomUUID(),
        tokenDigest: randomBytes(32).toString("base64url"),
        status: "pending",
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      },
    });
    // A started but unconfirmed link opens nothing.
    await expect(read()).resolves.toMatchObject({
      reason: "telegram_link_required",
    });

    await testDatabase.prisma.telegramLinkTransaction.update({
      where: { linkRef },
      data: { status: "linked" },
    });
    await expect(read()).resolves.toMatchObject({
      effect: "allow",
      reason: "telegram_account",
      checkedContentVersion: 3,
    });
    await expect(
      contentAccess.checkAvailabilityMany({
        subject: { kind: "account", accountId },
        operations: [
          {
            itemId: "lesson",
            action: "read",
            resource: { kind: "material", materialId: lesson.materialId },
          },
        ],
        enforcementPoint: "published_material_read",
        correlationId: randomUUID(),
      }),
    ).resolves.toEqual({
      ok: true,
      items: [{ itemId: "lesson", availability: "available" }],
    });

    await testDatabase.prisma.telegramLinkTransaction.update({
      where: { linkRef },
      data: { status: "replayed" },
    });
    await expect(read()).resolves.toMatchObject({
      reason: "telegram_link_required",
    });
  });
});
