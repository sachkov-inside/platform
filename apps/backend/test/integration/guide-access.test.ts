import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
import { assembleVideos } from "../../src/modules/videos/index.js";
import { createTestVideoProvider } from "../../src/modules/videos/adapters/kinescope/test-video-provider.js";
import { assembleAssetResourceFacts } from "../../src/modules/materials/adapters/content-access/asset-resource-facts.js";
import { assembleVideoResourceFacts } from "../../src/modules/materials/adapters/content-access/video-resource-facts.js";
import { assembleMaterialAssetDelivery } from "../../src/modules/materials/features/deliver-material-asset/deliver-material-asset.js";
import { assembleVideoPlayback } from "../../src/modules/materials/facets/video-playback/video-playback.js";
import type {
  ObjectStorage,
  StoredObject,
} from "../../src/infrastructure/object-storage/index.js";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assembleAccounts,
  accountId,
} from "../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  assembleMembershipEntitlements,
  type AccessCapability,
} from "../../src/modules/membership-entitlements/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import {
  assembleMaterials,
  assembleMaterialResourceFacts,
  PublishedSeriesComposition,
} from "../../src/modules/materials/index.js";
import {
  ReadingActivity,
  PersonalHome,
} from "../../src/modules/reading-activity/index.js";
import { discoverPublishedMaterials } from "../../src/modules/content-library/index.js";
import { materialId } from "../../src/modules/materials/domain/material-identifiers.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { hasText } from "../../src/infrastructure/contracts/text.js";

// Every access read and write uses production facets over real PostgreSQL.
// No bank payment, Telegram link, public offer or production grant is created.
describe("independent guide, library, support and shared chat rights", () => {
  let db: TestDatabase;
  const owner = randomUUID(),
    buyer = randomUUID(),
    guideA = randomUUID(),
    guideB = randomUUID(),
    topicId = randomUUID();
  let now = new Date("2030-01-01T00:00:00Z");
  let grants: ReturnType<typeof assembleAccessGrants>;
  let membership: ReturnType<typeof assembleMembershipEntitlements>;
  let materials: ReturnType<typeof assembleMaterials>;
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    for (const id of [owner, buyer])
      await db.prisma.account.create({
        data: { id, logtoIssuer: "https://identity.test", logtoSubject: id },
      });
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-scoped-access-fingerprint-key",
    });
    grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      clock: () => now,
    });
    membership = assembleMembershipEntitlements({
      prisma: db.prisma,
      clock: () => now,
    });
    await db.prisma.topic.create({
      data: { id: topicId, slug: "scoped-topic", name: "Synthetic scope" },
    });
    for (const id of [guideA, guideB])
      await db.prisma.guide.create({
        data: { id, slug: id, name: `Synthetic ${id}` },
      });
    materials = assembleMaterials({
      prisma: db.prisma,
      authorPolicy: { canManage: (id) => id === owner },
    });
  });
  afterAll(async () => db.dispose());
  async function grant(
    capabilities: AccessCapability[],
    validUntil: string | null,
    source: "manual" | "legacy" = "manual",
  ) {
    const preview = await grants.previewBatch(owner, {
      operationId: randomUUID(),
      rows: [
        {
          rowKey: "fixture",
          accountId: buyer,
          source,
          sourceRef: randomUUID(),
          terms: {
            capabilities,
            contentScope: { guideIds: [guideA, guideB], materialIds: [] },
            startsAt: "2030-01-01T00:00:00Z",
            validUntil,
            reason: "Controlled #407 fixture",
          },
        },
      ],
    });
    if (!preview.ok) throw new Error(preview.error.code);
    const result = await grants.applyBatch(owner, {
      operationId: randomUUID(),
      previewRef: preview.previewRef,
      expectedRevision: preview.revision,
      confirmedRows: ["fixture"],
    });
    const row = result.ok ? result.rows[0]?.result : undefined;
    if (row === undefined || !row.ok || !("grantRef" in row))
      throw new Error("Grant fixture failed");
    return row;
  }
  async function material(
    seriesIds: string[],
    publicationState: "draft" | "published" = "published",
    access: "free" | "membership" = "membership",
  ) {
    const id = randomUUID();
    const metadata = {
      title: id,
      summary: "Controlled guide access",
      access,
      topicId,
      formatId: "guide",
      tagIds: [],
      difficulty: null,
      outcomes: [],
      seriesIds,
    };
    const created = await materials.authoring.createDraft({
      actor: owner,
      idempotencyKey: randomUUID(),
      metadata,
      body: representativeDocument("Protected content"),
    });
    if (!created.ok) throw new Error(created.error.code);
    if (publicationState === "published") {
      const saved = await materials.authoring.saveMaterial({
        actor: owner,
        idempotencyKey: randomUUID(),
        materialId: created.value.materialId,
        expectedContentVersion: 1,
        publicationState,
        metadata,
        body: representativeDocument("Protected content"),
      });
      if (!saved.ok) throw new Error(saved.error.code);
    }
    return materialId(created.value.materialId);
  }
  test("archived Guide programme, progress and continuation stay open only to its holder", async () => {
    const guideId = randomUUID();
    const slug = `archived-${guideId}`;
    await db.prisma.guide.create({
      data: { id: guideId, slug, name: "Archived programme" },
    });
    const lesson = await material([guideId], "published", "free");
    const lessonSlug = (
      await db.prisma.material.findUniqueOrThrow({ where: { id: lesson } })
    ).slug;
    if (lessonSlug === null) throw new Error("Published lesson has no slug");
    await grant([`guide:${guideId}`], null);
    const contentAccess = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements: membership,
    });
    const reader = assembleMaterials({
      prisma: db.prisma,
      authorPolicy: { canManage: () => false },
      contentAccess,
    }).publishedMaterialReader;
    const composition = new PublishedSeriesComposition(db.prisma);
    const reading = new ReadingActivity({
      prisma: db.prisma,
      materialContent: materials.materialContent,
      contentAccess,
      composition,
    });
    const videos = {
      loadReadyDurations: () =>
        Promise.resolve({ ok: true as const, value: [] }),
      loadProgressMany: () => Promise.resolve({ ok: true as const, value: [] }),
    };
    const subject = { kind: "account" as const, accountId: accountId(buyer) };
    await db.prisma.guide.update({
      where: { id: guideId },
      data: { archivedAt: new Date() },
    });
    for (const denied of [
      { kind: "anonymous" as const },
      { kind: "account" as const, accountId: accountId(randomUUID()) },
    ]) {
      expect(
        await discoverPublishedMaterials(reader, contentAccess, videos, {
          kind: "series",
          slug,
          first: null,
          subject: denied,
        }),
      ).toMatchObject({ ok: false, error: { code: "discovery_not_found" } });
      expect(
        await reader.read({ slug: lessonSlug, subject: denied }),
      ).toMatchObject({ ok: false, error: { code: "material_not_found" } });
    }
    expect(await reader.read({ slug: lessonSlug, subject })).toMatchObject({
      ok: true,
      value: { kind: "available", cacheScope: "private-no-store" },
    });
    const unavailableAccess = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements: {
        resolveForAccess: () =>
          Promise.resolve({ kind: "unavailable" as const }),
      },
    });
    const unavailableReader = assembleMaterials({
      prisma: db.prisma,
      authorPolicy: { canManage: () => false },
      contentAccess: unavailableAccess,
    }).publishedMaterialReader;
    expect(
      await discoverPublishedMaterials(
        unavailableReader,
        unavailableAccess,
        videos,
        {
          kind: "series",
          slug,
          first: null,
          subject,
        },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "dependency_unavailable", retryable: true },
    });
    expect(
      await unavailableReader.read({ slug: lessonSlug, subject }),
    ).toMatchObject({
      ok: false,
      error: { code: "dependency_unavailable", retryable: true },
    });
    expect(
      await composition.read(guideId, {
        subject,
        contentAccess: unavailableAccess,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "dependency_unavailable" },
    });
    const programme = await discoverPublishedMaterials(
      reader,
      contentAccess,
      videos,
      { kind: "series", slug, first: null, subject },
    );
    expect(programme).toMatchObject({
      ok: true,
      value: { items: [{ availability: "available" }] },
    });
    expect(
      await reading.getSeriesProgress({ accountId: buyer, seriesId: guideId }),
    ).toMatchObject({ ok: true, value: { total: 1, read: 0 } });
    const home = new PersonalHome({
      prisma: db.prisma,
      materialContent: materials.materialContent,
      contentAccess,
      composition,
      reader,
      videos,
      selection: {
        read: () => Promise.resolve({ ok: true as const, value: [] }),
      },
    });
    expect(await home.getSeries(buyer, slug)).toMatchObject({
      ok: true,
      value: { total: 1, read: 0 },
    });
    expect(
      await reading.getSeriesProgress({
        accountId: randomUUID(),
        seriesId: guideId,
      }),
    ).toMatchObject({ ok: false, error: { code: "series_not_found" } });
  });

  test("guide A allows its shared Material and direct resource only; B, draft and forged guide context stay denied", async () => {
    const [a, shared, b, draft] = await Promise.all([
      material([guideA]),
      material([guideA, guideB]),
      material([guideB]),
      material([guideA], "draft"),
    ]);
    const guide = await grant([`guide:${guideA}`], null);
    const access = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      accountPermissions: {
        hasMaterialsManage: (id) => Promise.resolve(id === owner),
      },
      membershipEntitlements: membership,
    });
    const context = {
      enforcementPoint: "published_material_read" as const,
      correlationId: randomUUID(),
    };
    const subject = { kind: "account" as const, accountId: accountId(buyer) };
    for (const id of [a, shared])
      expect(
        await access.authorize({
          ...context,
          subject,
          action: "read",
          resource: { kind: "material", materialId: id },
        }),
      ).toMatchObject({ effect: "allow", validUntil: null });
    for (const id of [b, draft])
      expect(
        await access.authorize({
          ...context,
          subject,
          action: "read",
          resource: { kind: "material", materialId: id },
        }),
      ).toMatchObject({ effect: "deny" });
    const forged = {
      ...context,
      subject,
      action: "read" as const,
      resource: { kind: "material" as const, materialId: b },
      guideId: guideA,
    };
    expect(await access.authorize(forged)).toMatchObject({ effect: "deny" });
    expect(
      await access.checkAvailabilityMany({
        ...context,
        subject,
        operations: [
          {
            itemId: "A",
            action: "read",
            resource: { kind: "material", materialId: a },
          },
          {
            itemId: "B",
            action: "read",
            resource: { kind: "material", materialId: b },
          },
        ],
      }),
    ).toMatchObject({
      ok: true,
      items: [{ availability: "available" }, { availability: "locked" }],
    });
    expect(await membership.resolveForAccess(accountId(buyer))).toEqual({
      kind: "required",
    });
    // A library subscription expires independently of a lifetime guide grant. Materials come from a paid
    // period or a tier, never from a direct grant.
    const library = await grants.applyPaidPeriod({
      eventRef: randomUUID(),
      periodRef: randomUUID(),
      accountId: buyer,
      revision: 1,
      revoked: false,
      terms: {
        capabilities: ["materials"],
        contentScope: { guideIds: [guideA, guideB], materialIds: [] },
        startsAt: "2030-01-01T00:00:00Z",
        validUntil: "2030-02-01T00:00:00Z",
        reason: "Controlled library subscription",
      },
    });
    if (!library.ok) throw new Error("Library period fixture failed");
    expect(
      await access.authorize({
        ...context,
        subject,
        action: "read",
        resource: { kind: "material", materialId: b },
      }),
    ).toMatchObject({ effect: "allow" });
    now = new Date("2030-02-02T00:00:00Z");
    expect(
      await access.authorize({
        ...context,
        subject,
        action: "read",
        resource: { kind: "material", materialId: b },
      }),
    ).toMatchObject({ effect: "deny" });
    expect(
      await access.authorize({
        ...context,
        subject,
        action: "read",
        resource: { kind: "material", materialId: shared },
      }),
    ).toMatchObject({ effect: "allow" });
    const revoke = {
      action: "revoke" as const,
      operationId: randomUUID(),
      grantRef: guide.grantRef,
      expectedRevision: 1,
      reason: "Controlled revocation",
    };
    const results = await Promise.all([
      grants.changeGrant(owner, revoke),
      grants.changeGrant(owner, revoke),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(
      await access.authorize({
        ...context,
        subject,
        action: "read",
        resource: { kind: "material", materialId: a },
      }),
    ).toMatchObject({ effect: "deny" });
  });
  test("direct file delivery and video tokens use real guide scope facts and recheck revoked access", async () => {
    now = new Date("2030-03-01T00:00:00Z");
    const grantA = await grant([`guide:${guideA}`], null);
    const objects = new Map<string, StoredObject>();
    const storage: ObjectStorage = {
      putImmutable: (input) => {
        objects.set(`${input.namespace}:${input.key}`, {
          body: input.body,
          checksumSha256: input.checksumSha256,
          contentLength: input.body.length,
          contentType: input.contentType,
        });
        return Promise.resolve({ ok: true });
      },
      read: (namespace, key) =>
        Promise.resolve(objects.get(`${namespace}:${key}`) ?? null),
      delete: (namespace, key) => {
        objects.delete(`${namespace}:${key}`);
        return Promise.resolve();
      },
      signGet: (input) =>
        Promise.resolve(
          `https://storage.example.test/${input.key}?ttl=${String(input.ttlSeconds)}`,
        ),
    };
    const assets = assembleMaterialAssets({
      prisma: db.prisma,
      objectStorage: storage,
    });
    const videos = assembleVideos({
      prisma: db.prisma,
      provider: createTestVideoProvider(),
      projects: { free: "free", membership: "members" },
      canManage: () => Promise.resolve(false),
      clock: () => now,
    });
    const contentAccess = assembleContentAccess({
      assetResourceFacts: assembleAssetResourceFacts(assets),
      videoResourceFacts: assembleVideoResourceFacts(videos),
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      membershipEntitlements: membership,
    });
    const delivery = assembleMaterialAssetDelivery({
      assets,
      contentAccess,
      materialContent: materials.materialContent,
      objectStorage: storage,
      signedGetTtlSeconds: 60,
    });
    const playback = assembleVideoPlayback({
      contentAccess,
      videos,
      jwtSecret: "synthetic-playback-signing-key-407",
      jwtTtlSeconds: 60,
      clock: () => now,
    });
    const subject = { kind: "account" as const, accountId: accountId(buyer) };
    async function resourceFixture(
      ids: string[],
      access: "free" | "membership" = "membership",
    ) {
      const id = await material(ids, "published", access);
      const bytes = new TextEncoder().encode(
        "Controlled downloadable guide artifact",
      );
      const uploaded = await assets.upload({
        actor: owner,
        materialId: id,
        body: bytes,
        declaredContentType: "text/plain",
        declaredSize: bytes.length,
        expectedChecksumSha256: createHash("sha256")
          .update(bytes)
          .digest("hex"),
        filename: "guide-artifact.txt",
        idempotencyKey: randomUUID(),
        kind: "file",
      });
      if (!uploaded.ok) throw new Error(uploaded.error.code);
      const assetId = uploaded.value.assetId,
        videoId = randomUUID(),
        providerVideoId = randomUUID();
      await db.prisma.video.create({
        data: {
          id: videoId,
          materialId: id,
          createdBy: owner,
          access,
          projectId: access === "free" ? "free" : "members",
          providerVideoId,
          title: "Controlled protected video",
          origin: "platform_upload",
          providerStatus: "done",
          state: "ready",
          readyAt: now,
          providerVisibleAt: now,
          providerEmbedLocator: `https://kinescope.io/embed/${providerVideoId}`,
          durationSeconds: 60,
        },
      });
      await db.prisma.material.update({
        where: { id },
        data: {
          primaryVideoId: videoId,
          body: {
            type: "doc",
            content: [
              {
                type: "assetFile",
                attrs: {
                  nodeId: randomUUID(),
                  assetId,
                  label: "Guide artifact",
                },
              },
            ],
          },
        },
      });
      return { materialId: id, assetId, videoId, providerVideoId };
    }
    const [a, shared, b] = await Promise.all([
      resourceFixture([guideA]),
      resourceFixture([guideA, guideB]),
      resourceFixture([guideB]),
    ]);
    let savedToken = "";
    for (const resource of [a, shared]) {
      expect(
        await delivery.deliver({
          ...resource,
          contentVersion: 2,
          preview: false,
          subject,
        }),
      ).toMatchObject({
        ok: true,
        value: { kind: "redirect", cacheScope: "private-no-store" },
      });
      const session = await playback.createSession({
        ...resource,
        subject,
        correlationId: randomUUID(),
      });
      if (!session.ok || !hasText(session.value.drmAuthToken))
        throw new Error("Expected protected playback token");
      expect(
        await playback.authorizeProvider({
          providerVideoId: resource.providerVideoId,
          token: session.value.drmAuthToken,
        }),
      ).toBe(true);
      if (resource === a) savedToken = session.value.drmAuthToken;
    }
    expect(
      await delivery.deliver({
        ...b,
        contentVersion: 2,
        preview: false,
        subject,
      }),
    ).toMatchObject({ error: { code: "asset_not_found" } });
    expect(
      await playback.createSession({
        ...b,
        subject,
        correlationId: randomUUID(),
      }),
    ).toMatchObject({ error: { code: "access_denied" } });
    expect(
      await delivery.deliver({
        ...a,
        materialId: b.materialId,
        contentVersion: 2,
        preview: false,
        subject,
      }),
    ).toMatchObject({ error: { code: "asset_not_found" } });
    expect(
      await playback.createSession({
        ...a,
        materialId: b.materialId,
        subject,
        correlationId: randomUUID(),
      }),
    ).toMatchObject({ error: { code: "video_mismatch" } });
    await grants.changeGrant(owner, {
      action: "revoke",
      operationId: randomUUID(),
      grantRef: grantA.grantRef,
      expectedRevision: 1,
      reason: "Revoke controlled guide access",
    });
    expect(
      await playback.authorizeProvider({
        providerVideoId: a.providerVideoId,
        token: savedToken,
      }),
    ).toBe(false);
    expect(
      await delivery.deliver({
        ...a,
        contentVersion: 2,
        preview: false,
        subject,
      }),
    ).toMatchObject({ error: { code: "asset_not_found" } });
    const archivedId = randomUUID();
    await db.prisma.guide.create({
      data: { id: archivedId, slug: archivedId, name: "Archived resources" },
    });
    await grant([`guide:${archivedId}`], null);
    const archived = await resourceFixture([archivedId], "free");
    await db.prisma.guide.update({
      where: { id: archivedId },
      data: { archivedAt: now },
    });
    for (const denied of [
      { kind: "anonymous" as const },
      { kind: "account" as const, accountId: accountId(randomUUID()) },
    ]) {
      expect(
        await delivery.deliver({
          ...archived,
          contentVersion: 2,
          preview: false,
          subject: denied,
        }),
      ).toMatchObject({ ok: false, error: { code: "asset_not_found" } });
      expect(
        await playback.createSession({
          ...archived,
          subject: denied,
          correlationId: randomUUID(),
        }),
      ).toMatchObject({ ok: false, error: { code: "access_denied" } });
    }
    expect(
      await delivery.deliver({
        ...archived,
        contentVersion: 2,
        preview: false,
        subject,
      }),
    ).toMatchObject({
      ok: true,
      value: { kind: "redirect", cacheScope: "private-no-store" },
    });
    expect(
      await playback.createSession({
        ...archived,
        subject,
        correlationId: randomUUID(),
      }),
    ).toMatchObject({ ok: true });
  });

  test("two sources of the single chat survive one revocation; support expires separately and legacy lifetime remains", async () => {
    now = new Date("2030-01-01T00:00:00Z");
    const first = await grant(["community"], null);
    await grant(["community"], null, "legacy");
    await grant(["support"], "2030-01-02T00:00:00Z");
    expect(
      await grants.changeGrant(owner, {
        action: "revoke",
        operationId: randomUUID(),
        grantRef: first.grantRef,
        expectedRevision: 1,
        reason: "Controlled one-source revocation",
      }),
    ).toMatchObject({ ok: true });
    now = new Date("2030-01-03T00:00:00Z");
    const resolved = await grants.resolveCapabilities(buyer);
    if (!resolved.ok) throw new Error(resolved.error.code);
    expect(resolved.capabilities).toContainEqual({
      capability: "community",
      validUntil: null,
    });
    expect(
      resolved.capabilities.some((value) => value.capability === "support"),
    ).toBe(false);
  });
});
