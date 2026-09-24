import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
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

const unusedObjectStorage: ObjectStorage = {
  putImmutable: () => Promise.reject(new Error("object storage is not part of this scenario")),
  read: () => Promise.reject(new Error("object storage is not part of this scenario")),
  delete: () => Promise.reject(new Error("object storage is not part of this scenario")),
  signGet: () => Promise.reject(new Error("object storage is not part of this scenario")),
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
    await expect(database.prisma.videoDeletionOperation.count({
      where: { videoId },
    })).resolves.toBe(0);
    await expect(database.prisma.material.findUniqueOrThrow({
      select: { contentVersion: true },
      where: { id: materialId },
    })).resolves.toEqual({ contentVersion: BigInt(referenced.value.contentVersion) });
  });
});

async function insertReadyImage(materialId: string, uploadedBy: string): Promise<string> {
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
      readyAt: now,
      createdAt: now,
      updatedAt: now,
      orphanedAt: now,
    },
  });
  return id;
}

async function insertReadyVideo(materialId: string, createdBy: string): Promise<string> {
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
      content: [{
        type: "paragraph",
        attrs: { nodeId: randomUUID() },
        content: [{ type: "text", text }],
      }],
    },
  };
}

function imageBody(assetId: string) {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [{
        type: "assetImage",
        attrs: { alt: "Diagram", assetId, caption: null, nodeId: randomUUID() },
      }],
    },
  };
}
