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
        slug: "architecture",
      }),
    );
    expect(playlists.value).toContainEqual(
      expect.objectContaining({
        archived: true,
        materialCount: 1,
        slug: "platform-path",
      }),
    );
  });

  test("writes the Guide introduction, preserves it on an ordinary edit and refuses it on a Topic", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const guide = await authoring.createContentCollection({
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
    if (!guide.ok || !topic.ok) throw new Error("Expected collections");
    expect(guide.value.introduction).toEqual({
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
      collectionId: guide.value.id,
      expectedVersion: guide.value.version,
      introduction,
      kind: "series",
      name: guide.value.name,
      summary: guide.value.summary,
    });
    if (!written.ok) throw new Error(written.error.code);
    expect(written.value.introduction).toEqual(introduction);

    // An edit that does not carry the introduction keeps the authored text.
    const renamed = await authoring.updateContentCollection({
      actor,
      collectionId: guide.value.id,
      expectedVersion: written.value.version,
      kind: "series",
      name: "Инфраструктура, релизы и продакшен",
      summary: guide.value.summary,
    });
    if (!renamed.ok) throw new Error(renamed.error.code);
    expect(renamed.value.introduction).toEqual(introduction);

    // Repeating the same write on a stale version is the accepted no-op.
    await expect(
      authoring.updateContentCollection({
        actor,
        collectionId: guide.value.id,
        expectedVersion: written.value.version,
        introduction,
        kind: "series",
        name: renamed.value.name,
        summary: guide.value.summary,
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
    seriesIds: [seriesId],
    summary: `${title} summary.`,
    tagIds: [],
    title,
    topicId,
  };
}
