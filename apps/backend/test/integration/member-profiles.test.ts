import { createHash } from "node:crypto";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { accountId, type AccountId } from "../../src/modules/accounts/index.js";
import type { ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import type { MembershipAccessState } from "../../src/modules/membership-entitlements/index.js";
import {
  assembleMemberProfiles,
  assembleProfileAvatarMaintenance,
  moderateMemberProfile,
  type MemberProfiles,
  type ProfileAvatarMaintenance,
} from "../../src/modules/member-profiles/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const ownerAccountId = accountId("81000000-0000-4000-8000-000000000001");
const secondAccountId = accountId("81000000-0000-4000-8000-000000000002");
const viewerAccountId = accountId("81000000-0000-4000-8000-000000000003");
const storedObjects = new Map<string, Uint8Array>();
const deletedObjectKeys: string[] = [];
const signedGetRequests: Parameters<ObjectStorage["signGet"]>[0][] = [];
const objectStorage: ObjectStorage = {
  delete: (_namespace, key) => {
    storedObjects.delete(key);
    deletedObjectKeys.push(key);
    return Promise.resolve();
  },
  putImmutable: (input) => {
    if (storedObjects.has(input.key)) {
      return Promise.resolve({
        error: { code: "object_already_exists" as const },
        ok: false as const,
      });
    }
    storedObjects.set(input.key, input.body);
    return Promise.resolve({ ok: true as const });
  },
  read: () => Promise.resolve(null),
  signGet: (input) => {
    signedGetRequests.push(input);
    return Promise.resolve("https://storage.example.test/avatar");
  },
};

describe("MemberProfiles", () => {
  let database: TestDatabase;
  let maintenance: ProfileAvatarMaintenance;
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
      objectStorage,
      signedGetTtlSeconds: 60,
    });
    maintenance = assembleProfileAvatarMaintenance({
      objectStorage,
      prisma: database.prisma,
    });
  });

  beforeEach(async () => {
    membership.clear();
    storedObjects.clear();
    deletedObjectKeys.length = 0;
    signedGetRequests.length = 0;
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
        avatar: null,
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

  test("replaces and delivers only the current protected avatar to active members", async () => {
    const created = await createOwnerProfile(profiles);
    const first = await avatarBody("#d85f39");
    const uploaded = await profiles.changeAvatar({
      accountId: ownerAccountId,
      ...first,
      expectedVersion: created.version,
      kind: "upload",
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok || uploaded.profile.avatar === null) return;
    expect(uploaded.profile.version).toBe(2);
    expect(uploaded.profile.avatar.avatarId).toMatch(/^[0-9a-f-]{36}$/u);
    const firstAvatarId = uploaded.profile.avatar.avatarId;
    expect([...storedObjects.keys()]).toHaveLength(3);
    for (const body of storedObjects.values()) {
      await expect(sharp(body).metadata()).resolves.toMatchObject({ format: "webp" });
    }

    await expect(
      profiles.deliverAvatar({
        avatarId: firstAvatarId,
        publicProfileId: created.publicProfileId,
        size: 320,
        viewerAccountId: ownerAccountId,
      }),
    ).resolves.toEqual({ error: { code: "not_found" }, ok: false });
    membership.set(ownerAccountId, {
      kind: "active",
      validUntil: new Date(Date.now() + 30_000).toISOString(),
    });
    await expect(
      profiles.deliverAvatar({
        avatarId: firstAvatarId,
        publicProfileId: created.publicProfileId,
        size: 320,
        viewerAccountId: ownerAccountId,
      }),
    ).resolves.toEqual({
      location: "https://storage.example.test/avatar",
      ok: true,
    });
    expect(signedGetRequests.at(-1)?.ttlSeconds).toBeLessThanOrEqual(29);

    await expect(
      profiles.deliverAvatar({
        avatarId: firstAvatarId,
        publicProfileId: created.publicProfileId,
        size: 320,
        viewerAccountId,
      }),
    ).resolves.toEqual({ error: { code: "not_found" }, ok: false });
    membership.set(viewerAccountId, { kind: "expired" });
    await expect(
      profiles.deliverAvatar({
        avatarId: firstAvatarId,
        publicProfileId: created.publicProfileId,
        size: 320,
        viewerAccountId,
      }),
    ).resolves.toEqual({ error: { code: "not_found" }, ok: false });
    membership.set(viewerAccountId, {
      kind: "active",
      validUntil: "2030-01-01T01:00:00.000Z",
    });
    await expect(
      profiles.deliverAvatar({
        avatarId: firstAvatarId,
        publicProfileId: created.publicProfileId,
        size: 320,
        viewerAccountId,
      }),
    ).resolves.toEqual({
      location: "https://storage.example.test/avatar",
      ok: true,
    });
    membership.set(viewerAccountId, {
      kind: "active",
      validUntil: new Date(Date.now() + 500).toISOString(),
    });
    await expect(
      profiles.deliverAvatar({
        avatarId: firstAvatarId,
        publicProfileId: created.publicProfileId,
        size: 320,
        viewerAccountId,
      }),
    ).resolves.toEqual({ error: { code: "not_found" }, ok: false });
    membership.set(viewerAccountId, {
      kind: "active",
      validUntil: "2030-01-01T01:00:00.000Z",
    });

    const secondProfile = await profiles.createProfile({
      accountId: secondAccountId,
      bio: null,
      displayName: "Другой участник",
    });
    expect(secondProfile.ok).toBe(true);
    await expect(
      database.prisma.memberProfile.update({
        data: { avatarId: firstAvatarId },
        where: { accountId: secondAccountId },
      }),
    ).rejects.toThrow();

    const second = await avatarBody("#3f7f6b");
    const replaced = await profiles.changeAvatar({
      accountId: ownerAccountId,
      ...second,
      expectedVersion: uploaded.profile.version,
      kind: "upload",
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok || replaced.profile.avatar === null) return;
    expect(replaced.profile.version).toBe(3);
    expect(replaced.profile.avatar.avatarId).not.toBe(firstAvatarId);
    await expect(
      profiles.deliverAvatar({
        avatarId: firstAvatarId,
        publicProfileId: created.publicProfileId,
        size: 320,
        viewerAccountId,
      }),
    ).resolves.toEqual({ error: { code: "not_found" }, ok: false });
    await expect(
      profiles.deliverAvatar({
        avatarId: replaced.profile.avatar.avatarId,
        publicProfileId: created.publicProfileId,
        size: 320,
        viewerAccountId: secondAccountId,
      }),
    ).resolves.toEqual({ error: { code: "not_found" }, ok: false });

    const cleanup = await maintenance.cleanup({
      graceMs: 0,
      now: new Date(Date.now() + 1_000),
    });
    expect(cleanup).toEqual({ cleaned: 1, retained: 1 });
    expect(deletedObjectKeys).toHaveLength(3);
    expect([...storedObjects.keys()]).toHaveLength(3);
    expect([...storedObjects.keys()].every((key) => key.includes(replaced.profile.avatar?.avatarId ?? ""))).toBe(true);

    await database.prisma.memberProfile.update({
      data: { status: "disabled" },
      where: { accountId: ownerAccountId },
    });
    await expect(
      profiles.deliverAvatar({
        avatarId: replaced.profile.avatar.avatarId,
        publicProfileId: created.publicProfileId,
        size: 320,
        viewerAccountId,
      }),
    ).resolves.toEqual({ error: { code: "not_found" }, ok: false });
    await database.prisma.memberProfile.update({
      data: { status: "active" },
      where: { accountId: ownerAccountId },
    });

    await expect(
      profiles.changeAvatar({
        accountId: ownerAccountId,
        expectedVersion: uploaded.profile.version,
        kind: "remove",
      }),
    ).resolves.toEqual({
      error: { code: "conflict", currentVersion: 3 },
      ok: false,
    });
    await expect(
      profiles.changeAvatar({
        accountId: ownerAccountId,
        expectedVersion: replaced.profile.version,
        kind: "remove",
      }),
    ).resolves.toMatchObject({
      ok: true,
      profile: { avatar: null, version: 4 },
    });
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

async function avatarBody(background: string) {
  const body = await sharp({
    create: { background, channels: 3, height: 320, width: 480 },
  }).png().toBuffer();
  return {
    body,
    crop: { centerX: 0.5, centerY: 0.5, zoom: 1 },
    declaredContentType: "image/png",
    declaredSize: body.byteLength,
    expectedChecksumSha256: createHash("sha256").update(body).digest("hex"),
  } as const;
}
