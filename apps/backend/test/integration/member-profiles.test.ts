import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { accountId, type AccountId } from "../../src/modules/accounts/index.js";
import type { MembershipAccessState } from "../../src/modules/membership-entitlements/index.js";
import {
  assembleMemberProfiles,
  moderateMemberProfile,
  type MemberProfiles,
} from "../../src/modules/member-profiles/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const ownerAccountId = accountId("81000000-0000-4000-8000-000000000001");
const secondAccountId = accountId("81000000-0000-4000-8000-000000000002");
const viewerAccountId = accountId("81000000-0000-4000-8000-000000000003");

describe("MemberProfiles", () => {
  let database: TestDatabase;
  let profiles: MemberProfiles;
  const membership = new Map<AccountId, MembershipAccessState>();

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    profiles = assembleMemberProfiles({
      prisma: database.prisma,
      membershipEntitlements: {
        resolveForAccess: (targetAccountId) =>
          Promise.resolve(
            membership.get(targetAccountId) ?? { kind: "required" },
          ),
      },
    });
  });

  beforeEach(async () => {
    membership.clear();
    await database.prisma.memberProfile.deleteMany();
    await database.prisma.memberProfileAuditEvent.deleteMany();
    await database.prisma.account.deleteMany();
    await Promise.all([
      insertAccount(database, ownerAccountId, "owner"),
      insertAccount(database, secondAccountId, "second"),
      insertAccount(database, viewerAccountId, "viewer"),
    ]);
  });

  afterAll(async () => {
    await database.dispose();
  });

  test("creates one Profile per Account while allowing duplicate display names", async () => {
    const command = {
      accountId: ownerAccountId,
      displayName: "  Кирилл Сачков ",
      bio: null,
    };
    const concurrent = await Promise.all([
      profiles.createProfile(command),
      profiles.createProfile(command),
    ]);
    expect(concurrent.filter((result) => result.ok)).toHaveLength(1);
    expect(concurrent.filter((result) => !result.ok)).toEqual([
      { ok: false, error: { code: "profile_exists" } },
    ]);

    await expect(
      profiles.createProfile({ ...command, accountId: secondAccountId }),
    ).resolves.toMatchObject({
      ok: true,
      value: { displayName: "Кирилл Сачков", version: 1, status: "active" },
    });
    await expect(database.prisma.memberProfile.count()).resolves.toBe(2);
    await expect(
      database.prisma.memberProfileAuditEvent.findMany({
        orderBy: { createdAt: "asc" },
        select: { event: true },
      }),
    ).resolves.toEqual([
      { event: "profile_created" },
      { event: "profile_created" },
    ]);
  });

  test("protects updates with optimistic concurrency", async () => {
    const created = await createOwnerProfile(profiles);
    const updated = await profiles.updateProfile({
      accountId: ownerAccountId,
      expectedVersion: created.version,
      displayName: "Новое имя",
      bio: "Новая биография",
    });
    expect(updated).toMatchObject({
      ok: true,
      value: { displayName: "Новое имя", bio: "Новая биография", version: 2 },
    });
    await expect(
      profiles.updateProfile({
        accountId: ownerAccountId,
        expectedVersion: created.version,
        displayName: "Проигравшая запись",
        bio: null,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "conflict", currentVersion: 2 },
    });
    await expect(database.prisma.memberProfile.count()).resolves.toBe(1);

    const audit = await database.prisma.memberProfileAuditEvent.findMany();
    expect(JSON.stringify(audit)).not.toContain("Новое имя");
    expect(JSON.stringify(audit)).not.toContain("Новая биография");
    expect(audit.map(({ event }) => event)).toEqual([
      "profile_created",
      "profile_updated",
    ]);
  });

  test("returns only the accepted projection to active members", async () => {
    const created = await createOwnerProfile(profiles);
    membership.set(viewerAccountId, {
      kind: "active",
      validUntil: "2030-01-01T01:00:00.000Z",
    });

    const view = await profiles.viewProfile(
      viewerAccountId,
      created.publicProfileId,
    );
    expect(view).toEqual({
      ok: true,
      profile: {
        publicProfileId: created.publicProfileId,
        displayName: "Кирилл Сачков",
        bio: "Инженер и автор.",
      },
    });
    expect(JSON.stringify(view)).not.toMatch(
      /accountId|email|logto|telegram|permission|evidence|audit/iu,
    );

    for (const state of [
      { kind: "required" },
      { kind: "expired" },
      { kind: "stale" },
      { kind: "unavailable" },
    ] as const) {
      membership.set(viewerAccountId, state);
      await expect(
        profiles.viewProfile(viewerAccountId, created.publicProfileId),
      ).resolves.toEqual({ ok: false, error: { code: "not_found" } });
    }
  });

  test("supports manual disable/restore and hides disabled Profile", async () => {
    const created = await createOwnerProfile(profiles);
    membership.set(viewerAccountId, {
      kind: "active",
      validUntil: "2030-01-01T01:00:00.000Z",
    });

    await expect(
      moderateMemberProfile(
        database.prisma,
        created.publicProfileId,
        "disable",
      ),
    ).resolves.toMatchObject({ ok: true, changed: true, status: "disabled" });
    await expect(
      profiles.viewProfile(viewerAccountId, created.publicProfileId),
    ).resolves.toEqual({ ok: false, error: { code: "not_found" } });
    await expect(profiles.readPrivateProfile(ownerAccountId)).resolves.toMatchObject({
      ok: true,
      value: { kind: "profile", profile: { status: "disabled", version: 2 } },
    });
    await expect(
      moderateMemberProfile(
        database.prisma,
        created.publicProfileId,
        "restore",
      ),
    ).resolves.toMatchObject({ ok: true, changed: true, status: "active" });
  });

});

async function insertAccount(
  database: TestDatabase,
  targetAccountId: AccountId,
  subject: string,
): Promise<void> {
  await database.prisma.account.create({
    data: {
      id: targetAccountId,
      logtoIssuer: "https://identity.example.test/oidc",
      logtoSubject: subject,
      emailFingerprint: null,
    },
  });
}

async function createOwnerProfile(profiles: MemberProfiles) {
  const result = await profiles.createProfile({
    accountId: ownerAccountId,
    displayName: "Кирилл Сачков",
    bio: "Инженер и автор.",
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
