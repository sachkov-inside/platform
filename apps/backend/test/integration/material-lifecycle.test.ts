import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  anonymousSubject,
  assembleBaselineContentAccess,
  assembleMaterials,
} from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const ownerId = "71000000-0000-4000-8000-000000000001";
const topicId = "71000000-0000-4000-8000-000000000002";
const formatId = "71000000-0000-4000-8000-000000000003";

function metadata(title: string, slug = "public-lifecycle") {
  return {
    title,
    summary: "Current mutable Material.",
    slug,
    access: "free" as const,
    topicId,
    formatId,
    tagIds: [],
    seriesMemberships: [],
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
    const contentAccess = assembleBaselineContentAccess(authorPolicy);
    const { authoring, materialContent, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy,
      contentAccess,
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
      await materialContent.findAccessFacts(created.value.materialId),
    ).toEqual({
      ok: true,
      value: {
        materialId: created.value.materialId,
        publicationState: "published",
        access: "free",
        contentVersion: 3,
      },
    });
    expect(
      await materialContent.loadPublishedBody({
        materialId: created.value.materialId,
        checkedContentVersion: 2,
      }),
    ).toEqual({ ok: true, value: null });
    expect(
      await materialContent.loadPublishedBody({
        materialId: created.value.materialId,
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
        slug: "public-lifecycle",
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
  });

  test("hard-deletes a never-published draft and rejects deletion after publication", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === ownerId },
    });
    const draft = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "create-deletable-draft",
      metadata: metadata("Deletable draft", "deletable-draft"),
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
      await authoring.loadMaterial({
        actor: ownerId,
        materialId: draft.value.materialId,
      }),
    ).toEqual({ ok: false, error: { code: "material_not_found" } });

    const publishedDraft = await authoring.createDraft({
      actor: ownerId,
      idempotencyKey: "create-undeletable-draft",
      metadata: metadata("Undeletable", "undeletable-material"),
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
      metadata: metadata("Undeletable", "undeletable-material"),
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

  test("rejects stale input, preserves stable identity while unpublished and locks the slug", async () => {
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
      metadata: metadata("Concurrent", "concurrent-material"),
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
      metadata: metadata("Winner", "concurrent-material"),
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
        metadata: metadata("Rejected local input", "concurrent-material"),
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
      metadata: metadata("Winner", "concurrent-material"),
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
        slug: "concurrent-material",
      }),
    ).toEqual({ ok: false, error: { code: "material_not_found" } });

    const republished = await authoring.saveMaterial({
      actor: ownerId,
      idempotencyKey: "republish-concurrent-material",
      materialId: created.value.materialId,
      expectedContentVersion: 3,
      publicationState: "published",
      metadata: metadata("Republished", "concurrent-material"),
      body: representativeDocument("Republished body."),
    });
    if (!republished.ok) {
      throw new Error(republished.error.code);
    }
    expect(
      await authoring.saveMaterial({
        actor: ownerId,
        idempotencyKey: "reject-slug-change",
        materialId: created.value.materialId,
        expectedContentVersion: 4,
        publicationState: "published",
        metadata: metadata("Renamed", "renamed-material"),
        body: representativeDocument("Renamed body."),
      }),
    ).toEqual({
      ok: false,
      error: { code: "slug_locked", slug: "concurrent-material" },
    });
  });
});
