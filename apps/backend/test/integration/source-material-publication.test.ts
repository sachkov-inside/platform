import { accountId } from "../../src/modules/accounts/index.js";
import { createHash, randomUUID } from "node:crypto";
import type {
  ObjectStorage,
  StoredObject,
} from "../../src/infrastructure/object-storage/index.js";
import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
import { assembleVideos } from "../../src/modules/videos/index.js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";

const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const source = {
  id: "authoring-test-one",
  path: "materials/one.md",
  revision: "a".repeat(64),
  showInFeed: false,
};
const metadata = {
  title: "Imported",
  summary: null,
  access: "free" as const,
  difficulty: null,
  outcomes: [],
  topicId: null,
  formatId: "note" as const,
  tagIds: [],
  seriesIds: [],
};

describe("source publication only", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createMigratedTestDatabase();
  });
  afterAll(async () => {
    await database.dispose();
  });

  test("publication-only preserves current B through v4, v5, v6 instead of restoring old A", async () => {
    const objects = new Map<string, StoredObject>();
    const storage: ObjectStorage = {
      putImmutable(input) {
        objects.set(`${input.namespace}/${input.key}`, {
          body: input.body,
          checksumSha256: input.checksumSha256,
          contentLength: input.body.byteLength,
          contentType: input.contentType,
        });
        return Promise.resolve({ ok: true });
      },
      read: (namespace, key) =>
        Promise.resolve(objects.get(`${namespace}/${key}`) ?? null),
      delete(namespace, key) {
        objects.delete(`${namespace}/${key}`);
        return Promise.resolve();
      },
      signGet: ({ namespace, key }) =>
        Promise.resolve(`https://storage.example.test/${namespace}/${key}`),
    };
    const assets = assembleMaterialAssets({
      prisma: database.prisma,
      objectStorage: storage,
    });
    const videos = assembleVideos({
      prisma: database.prisma,
      canManage: () => Promise.resolve(true),
      projects: { free: "public", closed: "private" },
      provider: {
        delete: () => Promise.reject(new Error("unused")),
        initUpload: () => Promise.reject(new Error("unused")),
        find: ({ id }) =>
          Promise.resolve({
            id,
            projectId: "private",
            status: "done",
            durationSeconds: 100,
            title: "B video",
            embedLocator: `https://kinescope.io/embed/${id}`,
          }),
      },
    });
    const { authoring, publishedMaterialReader } = assembleMaterials({
      materialAssets: assets,
      videos,
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
    const topic = await authoring.createContentCollection({
      actor,
      kind: "topic",
      name: "Publication",
      slug: "publication-only",
      summary: "",
    });
    if (!topic.ok) throw new Error(topic.error.code);
    const product = await authoring.reserveSourceProduct({
      actor,
      sourceId: "publication-product",
      name: "B programme",
      slug: "publication-product",
      summary: "B",
    });
    if (!product.ok) throw new Error(product.error.code);
    const owned = { ...source, id: "publication-only" };
    const reserved = await authoring.reserveSourceMaterial({
      actor,
      source: owned,
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    const materialId = reserved.value.materialId;
    const video = await videos.attachExisting({
      actor,
      materialId,
      access: "closed",
      providerVideoId: randomUUID(),
    });
    if (!video.ok) throw new Error(video.error.code);
    const bytes = new TextEncoder().encode("B attachment");
    const asset = await assets.upload({
      actor,
      materialId,
      body: bytes,
      declaredContentType: "text/plain",
      declaredSize: bytes.length,
      expectedChecksumSha256: createHash("sha256").update(bytes).digest("hex"),
      filename: "B.txt",
      kind: "file",
      idempotencyKey: "B-file",
    });
    if (!asset.ok) throw new Error(asset.error.code);
    const command = {
      actor,
      materialId,
      source: owned,
      expectedContentVersion: 1,
      idempotencyKey: "old-A",
      publicationState: "draft" as const,
      primaryVideoId: null,
      metadata: {
        ...metadata,
        access: "closed" as const,
        seriesIds: [product.value.id],
        summary: "Publication test",
        topicId: topic.value.id,
      },
      body: representativeDocument("old A"),
    };
    expect(await authoring.applySourceMaterial(command)).toMatchObject({
      ok: true,
      value: { contentVersion: 2 },
    });
    const newer = {
      ...command,
      source: { ...owned, revision: "b".repeat(64), path: "new-B.md" },
      primaryVideoId: video.value.videoId,
      videoChapters: [
        { start: 0, title: "B introduction" },
        { start: 25, title: "B example" },
      ],
      body: {
        schemaVersion: 1 as const,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: randomUUID() },
              content: [{ type: "text", text: "new B" }],
            },
            {
              type: "assetFile",
              attrs: {
                assetId: asset.value.assetId,
                label: "B attachment",
                nodeId: randomUUID(),
              },
            },
          ],
        },
      },
      expectedContentVersion: 2,
      idempotencyKey: "new-B",
    };
    expect(await authoring.applySourceMaterial(newer)).toMatchObject({
      ok: true,
      value: { contentVersion: 3 },
    });
    expect(
      await authoring.applySourceMaterial({
        ...newer,
        expectedContentVersion: 3,
        publicationState: "published",
        idempotencyKey: "publish-B",
      }),
    ).toMatchObject({ ok: true, value: { contentVersion: 4 } });
    const before = await authoring.loadMaterial({ actor, materialId });
    if (!before.ok) throw new Error(before.error.code);
    const deliveryBefore = await assets.loadDelivery({
      assetId: asset.value.assetId,
      materialId,
    });
    const readerBefore = await publishedMaterialReader.read({
      subject: { kind: "account", accountId: accountId(actor) },
      slug: before.value.metadata.slug ?? "",
    });
    expect(readerBefore).toMatchObject({
      ok: true,
      value: { kind: "available", videoChapters: newer.videoChapters },
    });
    const transition = {
      actor,
      materialId,
      sourceId: owned.id,
      expectedContentVersion: 4,
      publicationState: "unpublished" as const,
      idempotencyKey: "unpublish-B",
    };
    for (const forbidden of [
      {
        ...transition,
        sourceId: "foreign-source",
        idempotencyKey: "foreign-publication",
      },
      {
        ...transition,
        actor: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        idempotencyKey: "unauthorized-publication",
      },
    ])
      expect(
        await authoring.transitionSourcePublication(forbidden),
      ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(await authoring.transitionPublication(transition)).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    const unpublished = await authoring.transitionSourcePublication(transition);
    expect(unpublished).toMatchObject({
      ok: true,
      value: { contentVersion: 5, publicationState: "unpublished" },
    });
    expect(await authoring.transitionSourcePublication(transition)).toEqual(
      unpublished,
    );
    expect(
      await authoring.transitionSourcePublication({
        ...transition,
        expectedContentVersion: 5,
        publicationState: "published",
        idempotencyKey: "republish-B",
      }),
    ).toMatchObject({ ok: true, value: { contentVersion: 6 } });
    const after = await authoring.loadMaterial({ actor, materialId });
    if (!after.ok) throw new Error(after.error.code);
    const content = ({
      contentVersion: _version,
      publicationState: _state,
      publishedAt: _at,
      ...value
    }: typeof before.value) => value;
    expect(content(after.value)).toEqual(content(before.value));
    expect(after.value.body).toEqual(before.value.body);
    expect(
      await assets.loadDelivery({ assetId: asset.value.assetId, materialId }),
    ).toEqual(deliveryBefore);
    const readerAfter = await publishedMaterialReader.read({
      subject: { kind: "account", accountId: accountId(actor) },
      slug: after.value.metadata.slug ?? "",
    });
    expect(readerAfter).toMatchObject({
      ok: true,
      value: {
        kind: "available",
        videoChapters: newer.videoChapters,
        projection: { access: "closed" },
      },
    });
    const order = await authoring.loadSeriesOrder({
      actor,
      seriesId: product.value.id,
    });
    expect(order).toMatchObject({
      ok: true,
      value: { items: [{ materialId }] },
    });

    const toC = {
      ...newer,
      expectedContentVersion: 6,
      publicationState: "published" as const,
      source: { ...owned, revision: "c".repeat(64) },
      body: representativeDocument("concurrent C"),
      idempotencyKey: "edit-C",
    };
    let reads = 0;
    let snapshotLoaded!: () => void;
    let releaseSave!: () => void;
    const loaded = new Promise<void>((resolve) => {
      snapshotLoaded = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const contender = assembleMaterials({
      prisma: database.prisma,
      materialAssets: assets,
      videos,
      authorPolicy: {
        canManage: async (id) => {
          reads++;
          if (reads === 2) {
            snapshotLoaded();
            await released;
          }
          return id === actor;
        },
      },
    });
    const racing = database.run(() =>
      contender.authoring.transitionSourcePublication({
        ...transition,
        expectedContentVersion: 6,
        idempotencyKey: "racing-publication",
      }),
    );
    await loaded;
    try {
      expect(await authoring.applySourceMaterial(toC)).toMatchObject({
        ok: true,
        value: { contentVersion: 7 },
      });
    } finally {
      releaseSave();
    }
    expect(await racing).toMatchObject({
      ok: false,
      error: { code: "stale_content_version", currentContentVersion: 7 },
    });
    expect(
      await authoring.transitionSourcePublication({
        ...transition,
        expectedContentVersion: 6,
        idempotencyKey: "stale-unpublish-C",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "stale_content_version", currentContentVersion: 7 },
    });
    expect(await authoring.transitionSourcePublication(transition)).toEqual(
      unpublished,
    );
    expect(await authoring.loadMaterial({ actor, materialId })).toMatchObject({
      ok: true,
      value: { contentVersion: 7, source: toC.source, body: toC.body },
    });
    // A separately reviewed full import remains the explicit route for a content rollback.
    expect(
      await authoring.applySourceMaterial({
        ...command,
        expectedContentVersion: 7,
        publicationState: "published",
        idempotencyKey: "explicit-reviewed-restore-A",
      }),
    ).toMatchObject({ ok: true, value: { contentVersion: 8 } });
    expect(await authoring.loadMaterial({ actor, materialId })).toMatchObject({
      ok: true,
      value: { source: owned, body: command.body },
    });

    expect(
      await authoring.transitionSourcePublication({
        ...transition,
        expectedContentVersion: 8,
        idempotencyKey: "unpublish-before-composition",
      }),
    ).toMatchObject({ ok: true, value: { contentVersion: 9 } });
    let compositionReads = 0;
    let compositionLoaded!: () => void;
    let releasePublication!: () => void;
    const compositionSnapshot = new Promise<void>((resolve) => {
      compositionLoaded = resolve;
    });
    const compositionReleased = new Promise<void>((resolve) => {
      releasePublication = resolve;
    });
    const compositionContender = assembleMaterials({
      prisma: database.prisma,
      materialAssets: assets,
      videos,
      authorPolicy: {
        canManage: async (id) => {
          compositionReads++;
          if (compositionReads === 2) {
            compositionLoaded();
            await compositionReleased;
          }
          return id === actor;
        },
      },
    });
    const republishAfterComposition = database.run(() =>
      compositionContender.authoring.transitionSourcePublication({
        ...transition,
        publicationState: "published",
        expectedContentVersion: 9,
        idempotencyKey: "composition-race",
      }),
    );
    await compositionSnapshot;
    try {
      const beforeRemoval = await authoring.loadSeriesOrder({
        actor,
        seriesId: product.value.id,
      });
      if (!beforeRemoval.ok) throw new Error(beforeRemoval.error.code);
      expect(
        await authoring.reorderSourceProduct({
          actor,
          sourceId: "publication-product",
          seriesId: product.value.id,
          expectedOrderVersion: beforeRemoval.value.orderVersion,
          orderedMaterialIds: [],
        }),
      ).toMatchObject({ ok: true });
    } finally {
      releasePublication();
    }
    expect(await republishAfterComposition).toMatchObject({
      ok: false,
      error: { code: "invalid_content" },
    });
    expect(
      await authoring.loadSeriesOrder({ actor, seriesId: product.value.id }),
    ).toMatchObject({ ok: true, value: { items: [] } });
  });
});
