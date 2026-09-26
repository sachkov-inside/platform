import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { assembleMaterialAssetMaintenance } from "../../src/modules/materials/features/cleanup-material-assets/cleanup-material-assets.js";
import {
  assembleVideoDeletionMaintenance,
  assembleVideos,
  requestVideoDeletion,
  type VideoProvider,
} from "../../src/modules/videos/index.js";
import { withExhaustedPool } from "./setup/exhausted-pool.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

// Save changes Material references in Assets and Videos; a Save that fails must leave both as they were.
let database: TestDatabase;

beforeAll(async () => {
  database = await createMigratedTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.dispose();
});

const metadata = {
  access: "free" as const,
  formatId: null,
  difficulty: null,
  outcomes: [],
  seriesIds: [],
  summary: null,
  tagIds: [],
  title: null,
  topicId: null,
};

const unusedVideoProvider: VideoProvider = {
  delete: () =>
    Promise.reject(
      new Error("the video provider is not part of this scenario"),
    ),
  find: () =>
    Promise.reject(
      new Error("the video provider is not part of this scenario"),
    ),
  initUpload: () =>
    Promise.reject(
      new Error("the video provider is not part of this scenario"),
    ),
};

const unusedObjectStorage: ObjectStorage = {
  putImmutable: () =>
    Promise.reject(new Error("object storage is not part of this scenario")),
  read: () =>
    Promise.reject(new Error("object storage is not part of this scenario")),
  delete: () =>
    Promise.reject(new Error("object storage is not part of this scenario")),
  signGet: () =>
    Promise.reject(new Error("object storage is not part of this scenario")),
};

describe("Material reference change", () => {
  test("a failed Save keeps Asset and Video references as they were", async () => {
    const actor = randomUUID();
    const materials = assembleMaterials({
      authorPolicy: { canManage: (accountId) => accountId === actor },
      materialAssets: assembleMaterialAssets({
        objectStorage: unusedObjectStorage,
        prisma: database.prisma,
      }),
      prisma: database.prisma,
    });
    const created = await materials.authoring.createDraft({
      actor,
      body: paragraphBody("Draft"),
      idempotencyKey: "reference-change-draft",
      metadata,
    });
    if (!created.ok) throw new Error(created.error.code);
    const materialId = created.value.materialId;
    const assetId = await insertReadyImage(materialId, actor);
    const videoId = await insertReadyVideo(materialId, actor);

    const referenced = await materials.authoring.saveMaterial({
      actor,
      body: imageBody(assetId),
      expectedContentVersion: created.value.contentVersion,
      idempotencyKey: "reference-change-referenced",
      materialId,
      metadata,
      publicationState: "draft",
    });
    if (!referenced.ok) throw new Error(referenced.error.code);
    const assetBefore = await readAsset(assetId);
    expect(assetBefore).toMatchObject({ currentlyReferenced: true });
    const videoBefore = await readVideo(videoId);

    // Removing the image and deleting the Video are both written before the detachment fails.
    const failed = await materials.authoring.saveMaterial({
      actor,
      body: paragraphBody("Without the image"),
      deleteVideoId: videoId,
      detachVideoIds: [randomUUID()],
      expectedContentVersion: referenced.value.contentVersion,
      idempotencyKey: "reference-change-failed",
      materialId,
      metadata,
      publicationState: "draft",
    });

    expect(failed).toMatchObject({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [{ code: "video_not_found", path: "/detachVideoIds" }],
      },
    });
    await expect(readAsset(assetId)).resolves.toEqual(assetBefore);
    await expect(readVideo(videoId)).resolves.toEqual(videoBefore);
    await expect(
      database.prisma.videoDeletionOperation.count({
        where: { videoId },
      }),
    ).resolves.toBe(0);
    await expect(
      database.prisma.material.findUniqueOrThrow({
        select: { contentVersion: true },
        where: { id: materialId },
      }),
    ).resolves.toEqual({
      contentVersion: BigInt(referenced.value.contentVersion),
    });
  });
});

describe("Reference reads on an exhausted pool", () => {
  test("reads Assets, Videos and Workshop in its own transaction", async () => {
    const actor = randomUUID();
    const materials = assembleMaterials({
      authorPolicy: { canManage: (accountId) => accountId === actor },
      prisma: database.prisma,
    });
    const created = await materials.authoring.createDraft({
      actor,
      body: paragraphBody("Workshop draft"),
      idempotencyKey: "exhausted-pool-draft",
      metadata: { ...metadata, access: "workshop" },
    });
    if (!created.ok) throw new Error(created.error.code);
    const materialId = created.value.materialId;
    const assetId = await insertReadyImage(materialId, actor);
    const videoId = await insertReadyVideo(materialId, actor);

    // Leaving workshop access asks Workshop, a primary Video with chapters asks Videos twice, and
    // the image asks Assets: every read would wait for a second connection the pool does not have.
    const saved = await withExhaustedPool(database, (prisma) =>
      assembleMaterials({
        authorPolicy: { canManage: (accountId) => accountId === actor },
        materialAssets: assembleMaterialAssets({
          objectStorage: unusedObjectStorage,
          prisma,
        }),
        prisma,
        videos: assembleVideos({
          canManage: () => Promise.resolve(true),
          prisma,
          projects: { free: "public-project", membership: "member-project" },
          provider: unusedVideoProvider,
        }),
      }).authoring.saveMaterial({
        actor,
        body: imageBody(assetId),
        expectedContentVersion: created.value.contentVersion,
        idempotencyKey: "exhausted-pool-save",
        materialId,
        metadata,
        primaryVideoId: videoId,
        publicationState: "draft",
        videoChapters: [{ start: 0, title: "Introduction" }],
      }),
    );

    expect(saved).toMatchObject({ ok: true });
    await expect(readAsset(assetId)).resolves.toMatchObject({
      currentlyReferenced: true,
    });
  });

  test("validation reads Assets in its own transaction", async () => {
    const actor = randomUUID();
    const topicId = randomUUID();
    await database.prisma.topic.create({
      data: { id: topicId, name: "Validation", slug: `validation-${topicId}` },
    });
    const complete = {
      ...metadata,
      formatId: "note",
      summary: "Complete",
      title: "Complete",
      topicId,
    };
    const authoring = assembleMaterials({
      authorPolicy: { canManage: (accountId) => accountId === actor },
      materialAssets: assembleMaterialAssets({
        objectStorage: unusedObjectStorage,
        prisma: database.prisma,
      }),
      prisma: database.prisma,
    }).authoring;
    const created = await authoring.createDraft({
      actor,
      body: paragraphBody("Draft"),
      idempotencyKey: "exhausted-pool-validation-draft",
      metadata: complete,
    });
    if (!created.ok) throw new Error(created.error.code);
    const materialId = created.value.materialId;
    const assetId = await insertReadyImage(materialId, actor);
    const saved = await authoring.saveMaterial({
      actor,
      body: imageBody(assetId),
      expectedContentVersion: created.value.contentVersion,
      idempotencyKey: "exhausted-pool-validation-save",
      materialId,
      metadata: complete,
      publicationState: "draft",
    });
    if (!saved.ok) throw new Error(saved.error.code);

    const validated = await withExhaustedPool(database, (prisma) =>
      assembleMaterials({
        authorPolicy: { canManage: (accountId) => accountId === actor },
        materialAssets: assembleMaterialAssets({
          objectStorage: unusedObjectStorage,
          prisma,
        }),
        prisma,
      }).authoring.validateMaterial({
        actor,
        expectedContentVersion: saved.value.contentVersion,
        materialId,
      }),
    );

    expect(validated).toMatchObject({ ok: true, value: { materialId } });
  });

  test("orphan Asset cleanup asks Materials in its own transaction", async () => {
    const actor = randomUUID();
    const materialId = await createDraft(actor, "exhausted-pool-cleanup");
    const assetId = await insertReadyImage(materialId, actor);
    await database.prisma.material.update({
      data: { body: imageBody(assetId).doc },
      where: { id: materialId },
    });
    // A stale orphan mark, older than the grace, so only this Asset becomes a cleanup candidate.
    await database.prisma.materialAsset.update({
      data: { orphanedAt: staleOrphanMark, updatedAt: staleOrphanMark },
      where: { id: assetId },
    });

    const cleanup = await withExhaustedPool(database, (prisma) =>
      assembleMaterialAssetMaintenance({
        assets: assembleMaterialAssets({
          objectStorage: unusedObjectStorage,
          prisma,
        }),
        config: {
          objectStorage: { orphanGraceMs: orphanGraceBeyondStaleMark },
        },
        covers: { cleanup: () => Promise.resolve({ cleaned: 0, retained: 0 }) },
        materials: assembleMaterials({
          authorPolicy: { canManage: () => false },
          prisma,
        }).materialContent,
      }).cleanup(),
    );

    expect(cleanup).toEqual({ cleaned: 0, ok: true, retained: 1 });
    await expect(readAsset(assetId)).resolves.toMatchObject({
      currentlyReferenced: true,
    });
  });

  test("Video deletion asks Materials in its own transaction", async () => {
    const actor = randomUUID();
    const materialId = await createDraft(
      actor,
      "exhausted-pool-video-deletion",
    );
    const videoId = await insertReadyVideo(materialId, actor);
    await database.prisma.material.update({
      data: { primaryVideoId: videoId },
      where: { id: materialId },
    });
    await expect(
      requestVideoDeletion(
        database.prisma,
        { actor, materialId, videoId },
        new Date(),
      ),
    ).resolves.toMatchObject({ ok: true });

    const processed = await withExhaustedPool(database, (prisma) => {
      const materials = assembleMaterials({
        authorPolicy: { canManage: () => false },
        prisma,
      });
      return assembleVideoDeletionMaintenance({
        prisma,
        provider: unusedVideoProvider,
      }).process({
        async isReferenced(transaction, input) {
          const reference =
            await materials.materialContent.containsVideoReference(
              transaction,
              input,
            );
          if (!reference.ok) throw new Error(reference.error.code);
          return reference.value;
        },
      });
    });

    // The Material still shows the Video, so the deletion stops as referenced instead of deleting.
    expect(processed).toEqual({
      ok: true,
      value: { deferred: 0, deleted: 0, failed: 1, retried: 0 },
    });
  });
});

const staleOrphanMark = new Date("2020-01-01T00:00:00.000Z");
const orphanGraceBeyondStaleMark = 365 * 24 * 60 * 60 * 1_000;

async function createDraft(
  actor: string,
  idempotencyKey: string,
): Promise<string> {
  const created = await assembleMaterials({
    authorPolicy: { canManage: (accountId) => accountId === actor },
    prisma: database.prisma,
  }).authoring.createDraft({
    actor,
    body: paragraphBody("Draft"),
    idempotencyKey,
    metadata,
  });
  if (!created.ok) throw new Error(created.error.code);
  return created.value.materialId;
}

async function insertReadyImage(
  materialId: string,
  uploadedBy: string,
): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await database.prisma.materialAsset.create({
    data: {
      id,
      materialId,
      uploadedBy,
      kind: "image",
      state: "ready",
      idempotencyKey: `reference-change-${id}`,
      requestFingerprint: "0".repeat(64),
      originalFilename: "diagram.png",
      declaredContentType: "image/png",
      declaredSize: 1,
      expectedChecksum: "0".repeat(64),
      actualContentType: "image/png",
      actualSize: 1,
      actualChecksum: "0".repeat(64),
      width: 1,
      height: 1,
      objectNonce: randomUUID(),
      quarantineObjectKey: `materials/${materialId}/assets/${id}/quarantine`,
      protectedObjectKey: `materials/${materialId}/assets/${id}/original`,
      readyAt: now,
      createdAt: now,
      updatedAt: now,
      orphanedAt: now,
    },
  });
  return id;
}

async function insertReadyVideo(
  materialId: string,
  createdBy: string,
): Promise<string> {
  const id = randomUUID();
  const providerVideoId = `reference-change-${id}`;
  const now = new Date();
  await database.prisma.video.create({
    data: {
      access: "free",
      createdAt: now,
      createdBy,
      id,
      materialId,
      origin: "platform_upload",
      projectId: "public-project",
      providerEmbedLocator: `https://kinescope.io/embed/${providerVideoId}`,
      providerStatus: "done",
      providerVideoId,
      providerVisibleAt: now,
      readyAt: now,
      state: "ready",
      title: "Reference change fixture",
      durationSeconds: 120,
      updatedAt: now,
    },
  });
  return id;
}

function readAsset(id: string) {
  return database.prisma.materialAsset.findUniqueOrThrow({
    select: { currentlyReferenced: true, orphanedAt: true, updatedAt: true },
    where: { id },
  });
}

function readVideo(id: string) {
  return database.prisma.video.findUniqueOrThrow({
    select: { deletedAt: true, detachedAt: true, state: true, updatedAt: true },
    where: { id },
  });
}

function paragraphBody(text: string) {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: randomUUID() },
          content: [{ type: "text", text }],
        },
      ],
    },
  };
}

function imageBody(assetId: string) {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "assetImage",
          attrs: {
            alt: "Diagram",
            assetId,
            caption: null,
            nodeId: randomUUID(),
          },
        },
      ],
    },
  };
}
