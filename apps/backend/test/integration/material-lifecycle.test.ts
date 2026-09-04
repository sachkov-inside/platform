import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { listPublishedMaterials } from "../../src/modules/content-library/index.js";
import {
  anonymousSubject,
  assembleContentAccess,
} from "../../src/modules/content-access/index.js";
import {
  assembleMaterialResourceFacts,
  assembleMaterials,
} from "../../src/modules/materials/index.js";
import { materialId } from "../../src/modules/materials/domain/material-identifiers.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const ownerId = "71000000-0000-4000-8000-000000000001";
const topicId = "71000000-0000-4000-8000-000000000002";
const formatId = "71000000-0000-4000-8000-000000000003";

function metadata(title: string) {
  return {
    title,
    summary: "Current mutable Material.",
    access: "free" as const,
    topicId,
    formatId,
    tagIds: [],
    seriesIds: [],
  };
}

describe("Material lifecycle", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await testDatabase.prisma.topic.create({
      data: { id: topicId, slug: "engineering", name: "Engineering" },
    });
    await testDatabase.prisma.format.create({
      data: { id: formatId, slug: "guide", name: "Guide" },
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("makes a published full-state Save visible on the next public read", async () => {
    const authorPolicy = {
      canManage: (accountId: string) => accountId === ownerId,
    };
    const {
      authoring,
      contentAccess: publishedContentAccess,
      materialContent,
      publishedMaterialReader,
    } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy,
    });
    const created = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "create-public-lifecycle",
      metadata: metadata("Initial title"),
      body: representativeDocument("Initial body."),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }
    const currentMaterialId = materialId(created.value.materialId);

    const published = await authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: "publish-public-lifecycle",
      materialId: created.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata: metadata("Published title"),
      body: representativeDocument("Published body."),
    });
    if (!published.ok) {
      throw new Error(published.error.code);
    }
    expect(published.value.materialId).toBe(created.value.materialId);
    expect(published.value.contentVersion).toBe(2);
    expect(published.value.publicationState).toBe("published");
    expect(typeof published.value.publishedAt).toBe("string");

    const liveSave = await authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: "save-live-public-lifecycle",
      materialId: created.value.materialId,
      expectedContentVersion: 2,
      publicationState: "published",
      metadata: metadata("Live title"),
      body: representativeDocument("Live body."),
    });
    expect(liveSave).toEqual({
      ok: true,
      value: {
        materialId: created.value.materialId,
        contentVersion: 3,
        publicationState: "published",
        publishedAt: published.value.publishedAt,
      },
    });

    expect(
      await materialContent.findAccessFacts(currentMaterialId),
    ).toEqual({
      ok: true,
      value: {
        materialId: created.value.materialId,
        publicationState: "published",
        access: "free",
        contentVersion: 3,
        primaryVideoId: null,
      },
    });
    expect(
      await materialContent.findAccessFactsMany([
        materialId("71000000-0000-4000-8000-000000000099"),
        currentMaterialId,
        currentMaterialId,
      ]),
    ).toEqual({
      ok: true,
      value: [
        {
          materialId: created.value.materialId,
          publicationState: "published",
          access: "free",
          contentVersion: 3,
          primaryVideoId: null,
        },
      ],
    });
    const findMany = vi.spyOn(testDatabase.prisma.material, "findMany");
    const contentAccessResult = await assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(materialContent),
      accountPermissions: {
        hasMaterialsManage: () => Promise.resolve(false),
      },
      membershipEntitlements: {
        resolveForAccess: () => Promise.resolve({ kind: "required" }),
      },
    }).checkAvailabilityMany({
      subject: { kind: "anonymous" },
      operations: [
        {
          itemId: "current-material",
          resource: {
            kind: "material",
            materialId: currentMaterialId,
          },
          action: "read",
        },
      ],
      enforcementPoint: "published_material_read",
      correlationId: "71000000-0000-4000-8000-000000000098",
    });
    expect(contentAccessResult).toEqual({
      ok: true,
      items: [{ itemId: "current-material", availability: "available" }],
    });
    expect(findMany).toHaveBeenCalledOnce();
    findMany.mockRestore();
    expect(
      await materialContent.loadPublishedBody({
        materialId: currentMaterialId,
        checkedContentVersion: 2,
      }),
    ).toEqual({ ok: true, value: null });
    expect(
      await materialContent.loadPublishedBody({
        materialId: currentMaterialId,
        checkedContentVersion: 3,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        doc: {
          content: [
            expect.any(Object),
            expect.objectContaining({
              content: [{ text: "Live body.", type: "text" }],
            }),
          ],
        },
      },
    });

    expect(
      await publishedMaterialReader.read({
        subject: anonymousSubject,
        slug: "published-title",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        kind: "available",
        projection: {
          materialId: created.value.materialId,
          contentVersion: 3,
          title: "Live title",
        },
        body: {
          blocks: [
            { kind: "heading" },
            {
              kind: "paragraph",
              content: [{ kind: "text", text: "Live body." }],
            },
          ],
        },
      },
    });

    expect(
      await listPublishedMaterials(
        publishedMaterialReader,
        publishedContentAccess,
        emptyCatalogVideos,
        { subject: { kind: "anonymous" }, first: 24 },
      ),
    ).toMatchObject({
      ok: true,
      value: {
        items: [
          {
            materialId: created.value.materialId,
            contentVersion: 3,
            title: "Live title",
          },
        ],
      },
    });
    const searchDocument =
      await testDatabase.prisma.materialSearchDocument.findUnique({
        where: { materialId: created.value.materialId },
      });
    expect(searchDocument).toMatchObject({
      materialId: created.value.materialId,
      contentVersion: 3n,
    });
    expect(searchDocument?.plainText).toContain("Live body.");
  });

  test("hard-deletes a never-published draft and rejects deletion after publication", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === ownerId },
    });
    const draft = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "create-deletable-draft",
      metadata: metadata("Deletable draft"),
      body: representativeDocument("Deletable."),
    });
    if (!draft.ok) {
      throw new Error(draft.error.code);
    }
    expect(
      await authoring.deleteDraft({
        actor: ownerId,
        idempotencyKey: "delete-deletable-draft",
        materialId: draft.value.materialId,
        expectedContentVersion: 1,
      }),
    ).toEqual({
      ok: true,
      value: { materialId: draft.value.materialId },
    });
    expect(
      await authoring.deleteDraft({
        actor: ownerId,
        idempotencyKey: "delete-deletable-draft",
        materialId: draft.value.materialId,
        expectedContentVersion: 1,
      }),
    ).toEqual({
      ok: true,
      value: { materialId: draft.value.materialId },
    });
    expect(
      await authoring.loadMaterial({
        actor: ownerId,
        materialId: draft.value.materialId,
      }),
    ).toEqual({ ok: false, error: { code: "material_not_found" } });

    const publishedDraft = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "create-undeletable-draft",
      metadata: metadata("Undeletable"),
      body: representativeDocument("Stable identity."),
    });
    if (!publishedDraft.ok) {
      throw new Error(publishedDraft.error.code);
    }
    const published = await authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: "publish-undeletable-draft",
      materialId: publishedDraft.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata: metadata("Undeletable"),
      body: representativeDocument("Stable identity."),
    });
    if (!published.ok) {
      throw new Error(published.error.code);
    }
    expect(
      await authoring.deleteDraft({
        actor: ownerId,
        idempotencyKey: "reject-published-delete",
        materialId: publishedDraft.value.materialId,
        expectedContentVersion: 2,
      }),
    ).toEqual({
      ok: false,
      error: { code: "draft_deletion_forbidden" },
    });
  });

  test("serializes concurrent publication and draft deletion without losing published data", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === ownerId },
    });
    const draft = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "create-lifecycle-delete-race",
      metadata: metadata("Lifecycle delete race"),
      body: representativeDocument("One winner."),
    });
    if (!draft.ok) throw new Error(draft.error.code);

    const [publication, deletion] = await Promise.all([
      authoring.saveMaterial({
        actor: ownerId,
        idempotencyKey: "publish-lifecycle-delete-race",
        materialId: draft.value.materialId,
        expectedContentVersion: 1,
        publicationState: "published",
        metadata: metadata("Lifecycle delete race"),
        body: representativeDocument("One winner."),
      }),
      authoring.deleteDraft({
        actor: ownerId,
        idempotencyKey: "delete-lifecycle-delete-race",
        materialId: draft.value.materialId,
        expectedContentVersion: 1,
      }),
    ]);

    expect([publication.ok, deletion.ok].filter(Boolean)).toHaveLength(1);
    const current = await authoring.loadMaterial({
      actor: ownerId,
      materialId: draft.value.materialId,
    });
    if (publication.ok) {
      expect(deletion).toEqual({
        ok: false,
        error: { code: "stale_content_version", currentContentVersion: 2 },
      });
      expect(current).toMatchObject({
        ok: true,
        value: { publicationState: "published" },
      });
    } else {
      expect(deletion).toEqual({
        ok: true,
        value: { materialId: draft.value.materialId },
      });
      expect(publication).toEqual({
        ok: false,
        error: { code: "material_not_found" },
      });
      expect(current).toEqual({
        ok: false,
        error: { code: "material_not_found" },
      });
    }
  });

  test("re-authorizes once when a concurrent Save changes contentVersion", async () => {
    const authorPolicy = {
      canManage: (accountId: string) => accountId === ownerId,
    };
    const base = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy,
    });
    const created = await base.authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "create-reader-race",
      metadata: metadata("Reader race"),
      body: representativeDocument("Version one."),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }
    const published = await base.authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: "publish-reader-race",
      materialId: created.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata: metadata("Reader race"),
      body: representativeDocument("Version two."),
    });
    if (!published.ok) {
      throw new Error(published.error.code);
    }

    let raced = false;
    const racingContentAccess = {
      checkAvailabilityMany:
        base.contentAccess.checkAvailabilityMany.bind(base.contentAccess),
      authorize: async (
        input: Parameters<typeof base.contentAccess.authorize>[0],
      ) => {
        const decision = await base.contentAccess.authorize(input);
        if (!raced && decision.effect === "allow") {
          raced = true;
          const saved = await base.authoring.saveMaterial({
            actor: ownerId,
            idempotencyKey: "win-reader-race",
            materialId: created.value.materialId,
            expectedContentVersion: 2,
            publicationState: "published",
            metadata: metadata("Reader race winner"),
            body: representativeDocument("Version three."),
          });
          if (!saved.ok) {
            throw new Error(saved.error.code);
          }
        }
        return decision;
      },
    };
    const { publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy,
      contentAccess: racingContentAccess,
    });
    const bodyRead = vi.spyOn(testDatabase.prisma.material, "findFirst");

    await expect(
      publishedMaterialReader.read({
        subject: { kind: "anonymous" },
        slug: "reader-race",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        kind: "available",
        projection: {
          contentVersion: 3,
          title: "Reader race winner",
        },
        body: {
          blocks: [
            { kind: "heading" },
            {
              kind: "paragraph",
              content: [{ kind: "text", text: "Version three." }],
            },
          ],
        },
      },
    });
    expect(bodyRead).toHaveBeenCalledTimes(2);
    bodyRead.mockRestore();
  });

  test("rejects stale input and preserves the generated address through later saves", async () => {
    const authorPolicy = {
      canManage: (accountId: string) => accountId === ownerId,
    };
    const { authoring, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy,
    });
    const created = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "create-concurrent-material",
      metadata: metadata("Concurrent"),
      body: representativeDocument("Initial local input."),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }

    const winner = await authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: "save-concurrent-winner",
      materialId: created.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata: metadata("Winner"),
      body: representativeDocument("Winner body."),
    });
    if (!winner.ok) {
      throw new Error(winner.error.code);
    }
    expect(
      await authoring.saveMaterial({
        actor: ownerId,
        idempotencyKey: "save-concurrent-stale",
        materialId: created.value.materialId,
        expectedContentVersion: 1,
        publicationState: "published",
        metadata: metadata("Rejected local input"),
        body: representativeDocument("Rejected local body."),
      }),
    ).toEqual({
      ok: false,
      error: { code: "stale_content_version", currentContentVersion: 2 },
    });

    const unpublished = await authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: "unpublish-concurrent-material",
      materialId: created.value.materialId,
      expectedContentVersion: 2,
      publicationState: "unpublished",
      metadata: metadata("Winner"),
      body: representativeDocument("Winner body."),
    });
    expect(unpublished).toMatchObject({
      ok: true,
      value: {
        materialId: created.value.materialId,
        contentVersion: 3,
        publicationState: "unpublished",
      },
    });
    expect(
      await publishedMaterialReader.read({
        subject: anonymousSubject,
        slug: "winner",
      }),
    ).toEqual({ ok: false, error: { code: "material_not_found" } });

    const republished = await authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: "republish-concurrent-material",
      materialId: created.value.materialId,
      expectedContentVersion: 3,
      publicationState: "published",
      metadata: metadata("Republished"),
      body: representativeDocument("Republished body."),
    });
    if (!republished.ok) {
      throw new Error(republished.error.code);
    }
    const renamed = await authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: "rename-with-stable-address",
      materialId: created.value.materialId,
      expectedContentVersion: 4,
      publicationState: "published",
      metadata: metadata("Renamed"),
      body: representativeDocument("Renamed body."),
    });
    if (!renamed.ok) throw new Error(renamed.error.code);
    expect(
      await authoring.loadMaterial({ actor: ownerId, materialId: created.value.materialId }),
    ).toMatchObject({ ok: true, value: { metadata: { slug: "winner" } } });
  });

  test("generates a readable slug when a Material is first published", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === ownerId },
    });
    const metadataWithoutSlug = {
      title: "Как устроена платформа Inside",
      summary: "Адрес формируется системой.",
      access: "free" as const,
      topicId,
      formatId,
      tagIds: [],
      seriesIds: [],
    };
    const created = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "create-automatic-slug",
      metadata: metadataWithoutSlug,
      body: representativeDocument("Automatic slug body."),
    });
    if (!created.ok) throw new Error(created.error.code);

    const published = await authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: "publish-automatic-slug",
      materialId: created.value.materialId,
      expectedContentVersion: created.value.contentVersion,
      publicationState: "published",
      metadata: metadataWithoutSlug,
      body: representativeDocument("Automatic slug body."),
    });
    if (!published.ok) throw new Error(published.error.code);

    expect(
      await authoring.loadMaterial({
        actor: ownerId,
        materialId: created.value.materialId,
      }),
    ).toMatchObject({
      ok: true,
      value: { metadata: { slug: "kak-ustroena-platforma-inside" } },
    });
  });

  test("allocates unique suffixes for concurrent publications with the same title", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const sharedMetadata = metadata("Одинаковый адрес");
    const drafts = await Promise.all(
      ["left", "right"].map((side) =>
        authoring.createDraft({
          actor: ownerId,
          idempotencyKey: `create-same-address-${side}`,
          metadata: sharedMetadata,
          body: representativeDocument(`${side} body.`),
        }),
      ),
    );
    const materialIds = drafts.map((draft) => {
      if (!draft.ok) throw new Error(draft.error.code);
      return draft.value.materialId;
    });

    const publications = await Promise.all(
      materialIds.map((currentMaterialId, index) =>
        authoring.saveMaterial({
          actor: ownerId,
          idempotencyKey: `publish-same-address-${String(index)}`,
          materialId: currentMaterialId,
          expectedContentVersion: 1,
          publicationState: "published",
          metadata: sharedMetadata,
          body: representativeDocument(`${String(index)} body.`),
        }),
      ),
    );
    expect(publications.every(({ ok }) => ok)).toBe(true);

    const loaded = await Promise.all(
      materialIds.map((currentMaterialId) =>
        authoring.loadMaterial({ actor: ownerId, materialId: currentMaterialId }),
      ),
    );
    expect(
      loaded
        .flatMap((current) =>
          current.ok && current.value.metadata.slug !== null
            ? [current.value.metadata.slug]
            : [],
        )
        .sort(),
    ).toEqual(["odinakovyy-adres", "odinakovyy-adres-2"]);
  });

  test("uses a stable fallback and keeps numeric suffixes within the length limit", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const publishAndLoadSlug = async (title: string, key: string) => {
      const selectedMetadata = metadata(title);
      const created = await authoring.createDraft({
        actor: ownerId,
        idempotencyKey: `create-slug-policy-${key}`,
        metadata: selectedMetadata,
        body: representativeDocument(`${key} body.`),
      });
      if (!created.ok) throw new Error(created.error.code);
      const published = await authoring.saveMaterial({
        actor: ownerId,
        idempotencyKey: `publish-slug-policy-${key}`,
        materialId: created.value.materialId,
        expectedContentVersion: 1,
        publicationState: "published",
        metadata: selectedMetadata,
        body: representativeDocument(`${key} body.`),
      });
      if (!published.ok) throw new Error(published.error.code);
      const loaded = await authoring.loadMaterial({
        actor: ownerId,
        materialId: created.value.materialId,
      });
      if (!loaded.ok || loaded.value.metadata.slug === null) {
        throw new Error(loaded.ok ? "missing_slug" : loaded.error.code);
      }
      return loaded.value.metadata.slug;
    };

    await expect(publishAndLoadSlug("🧭", "fallback-1")).resolves.toBe("material");
    await expect(publishAndLoadSlug("東京", "fallback-2")).resolves.toBe("material-2");

    const longTitle = "a".repeat(160);
    const longSlugs = await Promise.all(
      ["long-1", "long-2", "long-3"].map((key) =>
        publishAndLoadSlug(longTitle, key),
      ),
    );
    expect(longSlugs.sort()).toEqual([
      "a".repeat(118) + "-2",
      "a".repeat(118) + "-3",
      "a".repeat(120),
    ]);
    expect(longSlugs.every((slug) => slug.length <= 120)).toBe(true);
  });
});
