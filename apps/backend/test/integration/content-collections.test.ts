import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { assembleMaterials } from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const actor = "89500000-0000-4000-8000-000000000001";
const formatId = "guide";

describe("Topic and Playlist authoring", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("creates, edits, archives and preserves existing Material references", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const topic = await authoring.createContentCollection({
      actor,
      kind: "topic",
      name: "Architecture",
      slug: "architecture",
      summary: "Architecture decisions and boundaries.",
    });
    const playlist = await authoring.createContentCollection({
      actor,
      kind: "series",
      name: "Platform path",
      slug: "platform-path",
      summary: "An ordered path through the platform.",
    });
    if (!topic.ok || !playlist.ok) throw new Error("Expected collections");

    await expect(
      authoring.createContentCollection({
        actor,
        kind: "topic",
        name: "Duplicate",
        slug: topic.value.slug,
        summary: "",
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "content_collection_slug_conflict" },
    });

    const created = await authoring.createDraft({
      actor,
      idempotencyKey: "content-collections-existing-material",
      metadata: metadata(topic.value.id, playlist.value.id, "Existing"),
      body: representativeDocument("Existing Material body."),
    });
    if (!created.ok) throw new Error(created.error.code);

    const updatedTopic = await authoring.updateContentCollection({
      actor,
      collectionId: topic.value.id,
      expectedVersion: topic.value.version,
      kind: "topic",
      name: "System architecture",
      summary: "Stable decisions, boundaries and trade-offs.",
    });
    if (!updatedTopic.ok) throw new Error(updatedTopic.error.code);
    expect(updatedTopic.value).toMatchObject({
      name: "System architecture",
      slug: "architecture",
      version: 2,
    });
    await expect(
      authoring.updateContentCollection({
        actor,
        collectionId: topic.value.id,
        expectedVersion: topic.value.version,
        kind: "topic",
        name: "Stale edit",
        summary: "",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "stale_content_collection_version",
        currentVersion: updatedTopic.value.version,
      },
    });

    await expect(
      authoring.updateContentCollection({
        actor,
        collectionId: topic.value.id,
        expectedVersion: topic.value.version,
        kind: "topic",
        name: "System architecture",
        summary: "Stable decisions, boundaries and trade-offs.",
      }),
    ).resolves.toEqual(updatedTopic);

    const archivedTopic = await authoring.setContentCollectionArchive({
      actor,
      archived: true,
      collectionId: topic.value.id,
      expectedVersion: updatedTopic.value.version,
      kind: "topic",
    });
    const archivedPlaylist = await authoring.setContentCollectionArchive({
      actor,
      archived: true,
      collectionId: playlist.value.id,
      expectedVersion: playlist.value.version,
      kind: "series",
    });
    if (!archivedTopic.ok || !archivedPlaylist.ok) {
      throw new Error("Expected archived collections");
    }

    const references = await authoring.listReferences({ actor });
    if (!references.ok) throw new Error(references.error.code);
    expect(references.value.topics).toContainEqual(
      expect.objectContaining({ archived: true, id: topic.value.id }),
    );
    expect(references.value.series).toContainEqual(
      expect.objectContaining({ archived: true, id: playlist.value.id }),
    );

    await expect(
      authoring.saveMaterial({
        actor,
        body: representativeDocument("The existing link remains editable."),
        expectedContentVersion: 1,
        idempotencyKey: "content-collections-preserve-existing",
        materialId: created.value.materialId,
        metadata: metadata(topic.value.id, playlist.value.id, "Existing"),
        publicationState: "draft",
      }),
    ).resolves.toMatchObject({ ok: true });

    const rejected = await authoring.createDraft({
      actor,
      idempotencyKey: "content-collections-reject-new-assignment",
      metadata: metadata(topic.value.id, playlist.value.id, "New assignment"),
      body: representativeDocument("New Material body."),
    });
    expect(rejected).toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [
          {
            code: "series_archived",
            path: "/metadata/seriesMemberships/0/seriesId",
          },
          { code: "topic_archived", path: "/metadata/topicId" },
        ],
      },
    });

    const topics = await authoring.listContentCollections({
      actor,
      kind: "topic",
    });
    const playlists = await authoring.listContentCollections({
      actor,
      kind: "series",
    });
    if (!topics.ok || !playlists.ok) throw new Error("Expected lists");
    expect(topics.value).toContainEqual(
      expect.objectContaining({
        archived: true,
        materialCount: 1,
        publishedMaterialCount: 0,
        slug: "architecture",
      }),
    );
    expect(playlists.value).toContainEqual(
      expect.objectContaining({
        archived: true,
        materialCount: 1,
        publishedMaterialCount: 0,
        slug: "platform-path",
      }),
    );
  });

  test("counts published Materials of a Topic and published programme memberships of a Product next to all of them (#1720)", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const topic = await authoring.createContentCollection({
      actor,
      kind: "topic",
      name: "Published counts",
      slug: "published-counts",
      summary: "",
    });
    const product = await authoring.createContentCollection({
      actor,
      kind: "series",
      name: "Published counts product",
      slug: "published-counts-product",
      summary: "",
    });
    const emptyProduct = await authoring.createContentCollection({
      actor,
      kind: "series",
      name: "Published counts empty",
      slug: "published-counts-empty",
      summary: "",
    });
    if (!topic.ok || !product.ok || !emptyProduct.ok)
      throw new Error("Expected collections");
    expect(topic.value).toMatchObject({
      materialCount: 0,
      publishedMaterialCount: 0,
    });

    const materialIds: string[] = [];
    for (const title of ["Published one", "Published two", "Still draft"]) {
      const created = await authoring.createDraft({
        actor,
        idempotencyKey: `published-counts-${title}`,
        metadata: metadata(topic.value.id, product.value.id, title),
        body: representativeDocument(`${title} body.`),
      });
      if (!created.ok) throw new Error(created.error.code);
      materialIds.push(created.value.materialId);
    }
    const receipts = [];
    for (const materialId of materialIds.slice(0, 2)) {
      const published = await authoring.transitionPublication({
        actor,
        expectedContentVersion: 1,
        idempotencyKey: `published-counts-publish-${materialId}`,
        materialId,
        publicationState: "published",
      });
      if (!published.ok) throw new Error(published.error.code);
      receipts.push(published.value);
    }
    // A Material taken off publication counts among all Materials, not among published ones.
    const retired = receipts[1];
    if (retired === undefined) throw new Error("Expected a published Material");
    const unpublished = await authoring.transitionPublication({
      actor,
      expectedContentVersion: retired.contentVersion,
      idempotencyKey: `published-counts-unpublish-${retired.materialId}`,
      materialId: retired.materialId,
      publicationState: "unpublished",
    });
    if (!unpublished.ok) throw new Error(unpublished.error.code);

    const topics = await authoring.listContentCollections({
      actor,
      kind: "topic",
    });
    const products = await authoring.listContentCollections({
      actor,
      kind: "series",
    });
    if (!topics.ok || !products.ok) throw new Error("Expected lists");
    expect(topics.value).toContainEqual(
      expect.objectContaining({
        id: topic.value.id,
        materialCount: 3,
        publishedMaterialCount: 1,
      }),
    );
    expect(products.value).toContainEqual(
      expect.objectContaining({
        id: product.value.id,
        materialCount: 3,
        publishedMaterialCount: 1,
      }),
    );
    expect(products.value).toContainEqual(
      expect.objectContaining({
        id: emptyProduct.value.id,
        materialCount: 0,
        publishedMaterialCount: 0,
      }),
    );

    // One collection read back after a write carries the same counts.
    const renamedTopic = await authoring.updateContentCollection({
      actor,
      collectionId: topic.value.id,
      expectedVersion: topic.value.version,
      kind: "topic",
      name: "Published counts renamed",
      summary: "",
    });
    const renamedProduct = await authoring.updateContentCollection({
      actor,
      collectionId: product.value.id,
      expectedVersion: product.value.version,
      kind: "series",
      name: "Published counts product renamed",
      summary: "",
    });
    expect(renamedTopic).toMatchObject({
      ok: true,
      value: { materialCount: 3, publishedMaterialCount: 1 },
    });
    expect(renamedProduct).toMatchObject({
      ok: true,
      value: { materialCount: 3, publishedMaterialCount: 1 },
    });
  });

  test("writes the Product introduction, preserves it on an ordinary edit and refuses it on a Topic", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const product = await authoring.createContentCollection({
      actor,
      kind: "series",
      name: "Releases",
      slug: "releases",
      summary: "From a check to a confirmed update.",
    });
    const topic = await authoring.createContentCollection({
      actor,
      kind: "topic",
      name: "Delivery",
      slug: "delivery",
      summary: "",
    });
    if (!product.ok || !topic.ok) throw new Error("Expected collections");
    expect(product.value.introduction).toEqual({
      audience: "",
      outcome: "",
      prerequisites: "",
      scope: "",
    });
    expect(topic.value.introduction).toBeNull();

    const introduction = {
      audience: "Разработчики, которые впервые выпускают своё приложение.",
      outcome: "Настроить путь от проверок до подтверждённого обновления.",
      prerequisites: "Базовый Git и умение выполнить команду в терминале.",
      scope: "Один проект и один тестовый сервер; мониторинг пока в плане.",
    };
    const written = await authoring.updateContentCollection({
      actor,
      collectionId: product.value.id,
      expectedVersion: product.value.version,
      introduction,
      kind: "series",
      name: product.value.name,
      summary: product.value.summary,
    });
    if (!written.ok) throw new Error(written.error.code);
    expect(written.value.introduction).toEqual(introduction);

    // An edit that does not carry the introduction keeps the authored text.
    const renamed = await authoring.updateContentCollection({
      actor,
      collectionId: product.value.id,
      expectedVersion: written.value.version,
      kind: "series",
      name: "Инфраструктура, релизы и продакшен",
      summary: product.value.summary,
    });
    if (!renamed.ok) throw new Error(renamed.error.code);
    expect(renamed.value.introduction).toEqual(introduction);

    // Repeating the same write on a stale version is the accepted no-op.
    await expect(
      authoring.updateContentCollection({
        actor,
        collectionId: product.value.id,
        expectedVersion: written.value.version,
        introduction,
        kind: "series",
        name: renamed.value.name,
        summary: product.value.summary,
      }),
    ).resolves.toEqual(renamed);

    const rejected = await authoring.updateContentCollection({
      actor,
      collectionId: topic.value.id,
      expectedVersion: topic.value.version,
      introduction,
      kind: "topic",
      name: topic.value.name,
      summary: topic.value.summary,
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: "invalid_command", path: "/introduction" }],
      },
    });
  });
});

function metadata(topicId: string, seriesId: string, title: string) {
  return {
    access: "free" as const,
    formatId,
    difficulty: null,
    outcomes: [],
    seriesIds: [seriesId],
    summary: `${title} summary.`,
    tagIds: [],
    title,
    topicId,
  };
}
