import { createHash, randomUUID } from "node:crypto";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import {
  assembleContentCovers,
  assembleMaterials,
  type ContentCoverOwner,
} from "../../src/modules/materials/index.js";
import { listPublishedMaterials } from "../../src/modules/content-library/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { assembleContentCoverMaintenance } from "../../src/modules/materials/features/cleanup-content-covers/cleanup-content-covers.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const actor = "72000000-0000-4000-8000-000000000001";
const topicId = "72000000-0000-4000-8000-000000000002";
const seriesId = "72000000-0000-4000-8000-000000000007";

describe("ContentCovers", () => {
  let database: TestDatabase;
  let materialId: string;
  const stored = new Map<string, Uint8Array>();
  const signed: Parameters<ObjectStorage["signGet"]>[0][] = [];
  const objectStorage: ObjectStorage = {
    delete: (_namespace, key) => {
      stored.delete(key);
      return Promise.resolve();
    },
    putImmutable: (input) => {
      if (stored.has(input.key)) {
        return Promise.resolve({
          error: { code: "object_already_exists" as const },
          ok: false as const,
        });
      }
      stored.set(input.key, input.body);
      return Promise.resolve({ ok: true as const });
    },
    read: (_namespace, key) => {
      const body = stored.get(key);
      return Promise.resolve(
        body === undefined
          ? null
          : {
              body,
              checksumSha256: createHash("sha256").update(body).digest("hex"),
              contentLength: body.byteLength,
              contentType: "image/webp",
            },
      );
    },
    signGet: (input) => {
      signed.push(input);
      return Promise.resolve("https://storage.example.test/content-cover");
    },
  };

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await seedLocalDevelopment(database.prisma);
    const material = await database.prisma.material.findUniqueOrThrow({
      where: { slug: "kak-ustroen-inside-platform" },
      select: { id: true },
    });
    materialId = material.id;
  });

  afterAll(async () => {
    await database.dispose();
  });

  test("keeps cover object keys after deleting its draft owner until storage cleanup", async () => {
    const { authoring } = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: () => true },
    });
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: "cover-cleanup-draft",
      body: representativeDocument("Disposable cover owner."),
      metadata: {
        title: "Disposable cover owner", summary: null, access: "free",
        topicId: null, formatId: null, tagIds: [], difficulty: null, outcomes: [], seriesIds: [],
      },
    });
    if (!created.ok) throw new Error(created.error.code);
    const covers = assembleContentCovers({
      prisma: database.prisma, objectStorage, authorPolicy: { canManage: () => true },
    });
    const uploaded = await covers.change({
      actor, expectedCoverId: null, kind: "upload",
      owner: { id: created.value.materialId, kind: "material" },
      ...(await coverUpload("#325678")),
    });
    if (!uploaded.ok || uploaded.value.cover === null) throw new Error("Expected cover");
    const coverId = uploaded.value.cover.coverId;
    const before = await database.prisma.contentCoverRendition.findMany({ where: { coverId } });
    expect(before.length).toBeGreaterThan(0);
    await expect(authoring.deleteDraft({
      actor, materialId: created.value.materialId, expectedContentVersion: 1,
      idempotencyKey: "delete-cover-cleanup-draft",
    })).resolves.toMatchObject({ ok: true });
    await expect(database.prisma.material.findUnique({
      where: { id: created.value.materialId },
    })).resolves.toBeNull();
    await expect(database.prisma.contentCoverRendition.findMany({ where: { coverId } }))
      .resolves.toEqual(before);
    expect(before.every(({ publicObjectKey }) => stored.has(publicObjectKey))).toBe(true);
    const graceMs = 1_000;
    const orphanObservedAt = new Date(Date.now() + graceMs * 2);
    const maintenance = assembleContentCoverMaintenance({ prisma: database.prisma, objectStorage });
    await maintenance.cleanup({ graceMs, now: orphanObservedAt });
    await maintenance.cleanup({ graceMs, now: new Date(orphanObservedAt.getTime() + graceMs - 1) });
    expect(before.every(({ publicObjectKey }) => stored.has(publicObjectKey))).toBe(true);

    let calls = 0;
    const unreliable = assembleContentCoverMaintenance({
      prisma: database.prisma,
      objectStorage: {
        delete: (namespace, key) => {
          calls += 1;
          if (calls === 2) return Promise.reject(new Error("S3 unavailable"));
          return objectStorage.delete(namespace, key);
        },
      },
    });
    const readyAt = new Date(orphanObservedAt.getTime() + graceMs);
    await expect(unreliable.cleanup({ graceMs, now: readyAt })).rejects.toThrow("S3 unavailable");
    await expect(database.prisma.contentCoverRendition.findMany({ where: { coverId } }))
      .resolves.toEqual(before);
    // A fresh assembly models process restart; a claimed deletion retries
    // immediately, without waiting for the orphan grace a second time.
    await assembleContentCoverMaintenance({ prisma: database.prisma, objectStorage })
      .cleanup({ graceMs, now: new Date(readyAt.getTime() + 1) });
    expect(before.every(({ publicObjectKey }) => !stored.has(publicObjectKey))).toBe(true);
    await expect(database.prisma.contentCover.findUnique({ where: { id: coverId } })).resolves.toBeNull();
    await maintenance.cleanup({ graceMs, now: new Date(readyAt.getTime() + 2) });
  });

  test("uploads, replaces and removes a public Material cover without exposing storage keys", async () => {
    const covers = assembleContentCovers({
      authorPolicy: { canManage: (accountId) => accountId === actor },
      objectStorage,
      prisma: database.prisma,
    });
    const owner = { id: materialId, kind: "material" } satisfies ContentCoverOwner;
    const first = await coverUpload("#d85f39");
    const uploaded = await covers.change({
      actor,
      expectedCoverId: null,
      kind: "upload",
      owner,
      ...first,
    });
    if (!uploaded.ok || uploaded.value.cover === null) {
      throw new Error("Expected uploaded cover");
    }
    expect(uploaded.value.cover.coverId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(uploaded.value.cover.renditions).toEqual([
      { width: 480, height: 270 },
      { width: 960, height: 540 },
      { width: 1600, height: 900 },
    ]);
    expect(JSON.stringify(uploaded)).not.toMatch(/objectKey|checksum|original/iu);
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      authorPolicy: { canManage: () => false },
      prisma: database.prisma,
    });
    const catalog = await listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      emptyCatalogVideos,
      { subject: anonymousSubject, first: 24 },
    );
    if (!catalog.ok) throw new Error("Expected published catalog");
    expect(
      catalog.value.items.find(
        ({ slug }) => slug === "kak-ustroen-inside-platform",
      ),
    ).toMatchObject({
      cover: uploaded.value.cover,
      slug: "kak-ustroen-inside-platform",
    });
    const delivered = await covers.deliver({
      coverId: uploaded.value.cover.coverId,
      width: 960,
    });
    if (!delivered.ok) throw new Error("Expected public cover delivery");
    expect(delivered.contentLength).toBeGreaterThan(0);
    expect(delivered.contentType).toBe("image/webp");
    expect(signed).toEqual([]);
    await expect(
      covers.deliver({ coverId: uploaded.value.cover.coverId, width: 777 }),
    ).resolves.toEqual({ error: { code: "not_found" }, ok: false });

    const replacement = await covers.change({
      actor,
      expectedCoverId: uploaded.value.cover.coverId,
      kind: "upload",
      owner,
      ...(await coverUpload("#222222")),
    });
    expect(replacement).toMatchObject({ ok: true, value: { cover: {} } });
    if (!replacement.ok || replacement.value.cover === null) {
      throw new Error("Expected replacement cover");
    }
    expect(replacement.value.cover.coverId).not.toBe(uploaded.value.cover.coverId);
    await expect(
      covers.deliver({ coverId: uploaded.value.cover.coverId, width: 960 }),
    ).resolves.toEqual({ error: { code: "not_found" }, ok: false });

    const oldKeys = await database.prisma.contentCoverRendition.findMany({
      where: { coverId: uploaded.value.cover.coverId },
    });
    const currentKeys = await database.prisma.contentCoverRendition.findMany({
      where: { coverId: replacement.value.cover.coverId },
    });
    const maintenance = assembleContentCoverMaintenance({ prisma: database.prisma, objectStorage });
    await maintenance.cleanup({ graceMs: 1_000, now: new Date(Date.now() + 2_000) });
    expect(oldKeys.every(({ publicObjectKey }) => !stored.has(publicObjectKey))).toBe(true);
    expect(currentKeys.every(({ publicObjectKey }) => stored.has(publicObjectKey))).toBe(true);

    await expect(
      covers.change({
        actor,
        expectedCoverId: replacement.value.cover.coverId,
        kind: "remove",
        owner,
      }),
    ).resolves.toEqual({ ok: true, value: { cover: null } });
    await expect(
      covers.deliver({ coverId: replacement.value.cover.coverId, width: 960 }),
    ).resolves.toEqual({ error: { code: "not_found" }, ok: false });
    await maintenance.cleanup({ graceMs: 1_000, now: new Date(Date.now() + 4_000) });
    expect(currentKeys.every(({ publicObjectKey }) => !stored.has(publicObjectKey))).toBe(true);
  });

  test("retains the replacement while an old cover deletion is in flight", async () => {
    const covers = assembleContentCovers({
      prisma: database.prisma, objectStorage, authorPolicy: { canManage: () => true },
    });
    const owner = { id: materialId, kind: "material" } as const;
    const old = await covers.change({
      actor, owner, kind: "upload", expectedCoverId: null, ...(await coverUpload("#234567")),
    });
    if (!old.ok || old.value.cover === null) throw new Error("Expected cover");
    await covers.change({ actor, owner, kind: "remove", expectedCoverId: old.value.cover.coverId });
    const deletionStarted = deferredSignal();
    const finishDeletion = deferredSignal();
    const cleanup = assembleContentCoverMaintenance({
      prisma: database.prisma,
      objectStorage: {
        async delete(namespace, key) {
          deletionStarted.resolve();
          await finishDeletion.promise;
          await objectStorage.delete(namespace, key);
        },
      },
    }).cleanup({ graceMs: 1_000, now: new Date(Date.now() + 2_000) });
    await deletionStarted.promise;
    let replacement;
    try {
      replacement = await covers.change({
        actor, owner, kind: "upload", expectedCoverId: null, ...(await coverUpload("#654321")),
      });
    } finally {
      finishDeletion.resolve();
      await cleanup;
    }
    if (!replacement.ok || replacement.value.cover === null) throw new Error("Expected replacement");
    await expect(covers.deliver({ coverId: replacement.value.cover.coverId, width: 960 }))
      .resolves.toMatchObject({ ok: true });
    await expect(database.prisma.contentCover.findUnique({ where: { id: old.value.cover.coverId } }))
      .resolves.toBeNull();
    await covers.change({ actor, owner, kind: "remove", expectedCoverId: replacement.value.cover.coverId });
  });

  test.each(["confirmed", "ambiguous"] as const)("keeps a durable ledger for a late %s PUT", async (outcome) => {
    const id = randomUUID();
    await database.prisma.topic.create({ data: { id, name: "Late upload", slug: `late-${id}` } });
    const started = deferredSignal();
    const resume = deferredSignal();
    const writes: Promise<Awaited<ReturnType<ObjectStorage["putImmutable"]>>>[] = [];
    const covers = assembleContentCovers({
      prisma: database.prisma,
      authorPolicy: { canManage: () => true },
      objectStorage: {
        ...objectStorage,
        putImmutable(input) {
          const write = resume.promise.then(() => objectStorage.putImmutable(input));
          writes.push(write);
          if (writes.length === 3) started.resolve();
          return outcome === "confirmed" ? write : Promise.reject(new Error("PUT outcome unknown"));
        },
      },
    });
    const upload = covers.change({
      actor, owner: { id, kind: "topic" }, kind: "upload", expectedCoverId: null,
      ...(await coverUpload("#667788")),
    });
    await started.promise;
    if (outcome === "ambiguous") await upload;
    const cover = await database.prisma.contentCover.findFirstOrThrow({
      where: { topicId: id }, include: { renditions: true },
    });
    const maintenance = assembleContentCoverMaintenance({ prisma: database.prisma, objectStorage });
    const now = new Date(Date.now() + 2_000);
    try {
      await maintenance.cleanup({ graceMs: 1_000, now });
      await expect(database.prisma.contentCoverRendition.findMany({ where: { coverId: cover.id } }))
        .resolves.toEqual(cover.renditions);
    } finally {
      resume.resolve();
      await Promise.all(writes);
    }
    await expect(upload).resolves.toMatchObject({ ok: false, error: { code: "dependency_unavailable" } });
    await expect(database.prisma.topic.findUniqueOrThrow({ where: { id } }))
      .resolves.toMatchObject({ coverId: null });
    expect(cover.renditions.every(({ publicObjectKey }) => stored.has(publicObjectKey))).toBe(true);
    await maintenance.cleanup({ graceMs: 1_000, now: new Date(now.getTime() + 1) });
    expect(cover.renditions.every(({ publicObjectKey }) => !stored.has(publicObjectKey))).toBe(true);
    const remaining = await database.prisma.contentCover.findUnique({ where: { id: cover.id } });
    if (outcome === "confirmed") expect(remaining).toBeNull();
    else expect(remaining).not.toBeNull();
  });

  test.each(["topic", "series"] as const)("retains cleanup records after deleting a %s", async (kind) => {
    const id = randomUUID();
    const row = { id, name: "Disposable cover owner", slug: `cleanup-${id}` };
    if (kind === "topic") await database.prisma.topic.create({ data: row });
    else await database.prisma.guide.create({ data: row });
    const covers = assembleContentCovers({
      prisma: database.prisma, objectStorage, authorPolicy: { canManage: () => true },
    });
    const uploaded = await covers.change({
      actor, owner: { id, kind }, kind: "upload", expectedCoverId: null,
      ...(await coverUpload("#112233")),
    });
    if (!uploaded.ok || uploaded.value.cover === null) throw new Error("Expected cover");
    const coverId = uploaded.value.cover.coverId;
    const keys = await database.prisma.contentCoverRendition.findMany({ where: { coverId } });
    if (kind === "topic") await database.prisma.topic.delete({ where: { id } });
    else await database.prisma.guide.delete({ where: { id } });
    await expect(database.prisma.contentCoverRendition.findMany({ where: { coverId } })).resolves.toEqual(keys);
    const maintenance = assembleContentCoverMaintenance({ prisma: database.prisma, objectStorage });
    const now = new Date(Date.now() + 2_000);
    await maintenance.cleanup({ graceMs: 1_000, now });
    await maintenance.cleanup({ graceMs: 1_000, now: new Date(now.getTime() + 1_000) });
    expect(keys.every(({ publicObjectKey }) => !stored.has(publicObjectKey))).toBe(true);
  });

  test.each([
    { id: topicId, kind: "topic" as const },
    { id: seriesId, kind: "series" as const },
  ])("keeps $kind cover ownership concrete", async (owner) => {
    const covers = assembleContentCovers({
      authorPolicy: { canManage: (accountId) => accountId === actor },
      objectStorage,
      prisma: database.prisma,
    });
    const result = await covers.change({
      actor,
      expectedCoverId: null,
      kind: "upload",
      owner,
      ...(await coverUpload("#eadfc8")),
    });
    expect(result).toMatchObject({ ok: true, value: { cover: {} } });
    if (!result.ok || result.value.cover === null) return;
    const row = await database.prisma.contentCover.findUniqueOrThrow({
      where: { id: result.value.cover.coverId },
    });
    expect(row).toMatchObject({
      materialId: null,
      seriesId: owner.kind === "series" ? owner.id : null,
      topicId: owner.kind === "topic" ? owner.id : null,
    });
    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      authorPolicy: { canManage: () => false },
      prisma: database.prisma,
    });
    const catalog = await listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      emptyCatalogVideos,
      { subject: anonymousSubject, first: 24 },
    );
    expect(catalog).toMatchObject({ ok: true });
    if (!catalog.ok) return;
    const collection =
      owner.kind === "topic"
        ? catalog.value.facets.topics.find(({ id }) => id === owner.id)
        : catalog.value.facets.series.find(({ id }) => id === owner.id);
    expect(collection).toMatchObject({ cover: result.value.cover });
    await expect(
      publishedMaterialReader.discoverProjections({
        first: owner.kind === "series" ? null : 12,
        kind: owner.kind,
        slug: owner.kind === "topic" ? "platform" : "platform-inside",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { reference: { cover: result.value.cover } },
    });
  });

  test("fails a storage outage closed without publishing a processing cover", async () => {
    const covers = assembleContentCovers({
      authorPolicy: { canManage: (accountId) => accountId === actor },
      objectStorage: {
        ...objectStorage,
        putImmutable: () =>
          Promise.resolve({
            error: { code: "object_already_exists" as const },
            ok: false as const,
          }),
      },
      prisma: database.prisma,
    });

    await expect(
      covers.change({
        actor,
        expectedCoverId: null,
        kind: "upload",
        owner: { id: materialId, kind: "material" },
        ...(await coverUpload("#cc0000")),
      }),
    ).resolves.toEqual({
      error: { code: "dependency_unavailable", retryable: true },
      ok: false,
    });
    await expect(
      database.prisma.contentCover.findFirstOrThrow({
        orderBy: { createdAt: "desc" },
        where: { materialId, state: "failed" },
      }),
    ).resolves.toMatchObject({
      currentlyReferenced: false,
      failureCode: "storage_failure",
      state: "failed",
    });
  });
});

async function coverUpload(color: string) {
  const body = await sharp({
    create: {
      background: color,
      channels: 4,
      height: 900,
      width: 1600,
    },
  })
    .png()
    .toBuffer();
  return {
    body,
    declaredContentType: "image/png",
    declaredSize: body.byteLength,
    expectedChecksumSha256: createHash("sha256").update(body).digest("hex"),
    filename: "cover.png",
  } as const;
}

function deferredSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}
