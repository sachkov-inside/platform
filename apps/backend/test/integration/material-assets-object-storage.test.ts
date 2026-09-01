import { createHash, randomUUID } from "node:crypto";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { MinioContainer, type StartedMinioContainer } from "@testcontainers/minio";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { createS3ObjectStorage, type ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { objectStorageConformance } from "../support/object-storage-conformance.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const buckets = {
  protected: "inside-test-protected",
  public: "inside-test-public",
  quarantine: "inside-test-quarantine",
} as const;
const credentials = {
  accessKeyId: "inside-test-access-key",
  secretAccessKey: "inside-test-secret-key",
} as const;
const materialAssetLockRowsSchema = z
  .array(z.object({ id: z.uuid() }).strict())
  .length(1);
const materialAssetLockWaiterRowsSchema = z
  .array(z.object({ waiting: z.number().int().nonnegative() }).strict())
  .length(1);

let minio: StartedMinioContainer;
let storage: ObjectStorage;
let database: TestDatabase;

beforeAll(async () => {
  [minio, database] = await Promise.all([
    new MinioContainer("minio/minio:RELEASE.2025-09-07T16-13-09Z")
      .withUsername(credentials.accessKeyId)
      .withPassword(credentials.secretAccessKey)
      .start(),
    createMigratedTestDatabase(),
  ]);
  const config = {
    buckets,
    credentials,
    endpoint: minio.getConnectionUrl(),
    forcePathStyle: true,
    region: "us-east-1",
  } as const;
  const client = new S3Client(config);
  for (const Bucket of Object.values(buckets)) {
    await client.send(new CreateBucketCommand({ Bucket }));
  }
  storage = createS3ObjectStorage(config);
}, 120_000);

afterAll(async () => {
  await Promise.all([minio.stop(), database.dispose()]);
});

objectStorageConformance("S3ObjectStorage against MinIO", () => storage);

describe("MaterialAssets against PostgreSQL and S3", () => {
  test("uploads, verifies, projects, and removes an unreferenced immutable file", async () => {
    const assets = assembleMaterialAssets({
      objectStorage: storage,
      prisma: database.prisma,
    });
    const body = new TextEncoder().encode("Inside Material attachment\n");
    const materialId = randomUUID();
    const actor = randomUUID();
    const input = {
      actor,
      body,
      declaredContentType: "text/plain",
      declaredSize: body.byteLength,
      expectedChecksumSha256: createHash("sha256").update(body).digest("hex"),
      filename: "guide.txt",
      idempotencyKey: "integration-upload",
      kind: "file" as const,
      materialId,
    };
    const uploaded = await assets.upload(input);
    expect(uploaded).toMatchObject({
      ok: true,
      value: { contentType: "text/plain", filename: "guide.txt", kind: "file", state: "ready" },
    });
    if (!uploaded.ok) throw new Error(uploaded.error.code);
    await expect(assets.upload(input)).resolves.toEqual(uploaded);
    await expect(
      assets.inspectReferences(materialId, [{ assetId: uploaded.value.assetId, kind: "file" }]),
    ).resolves.toEqual({ ok: true, value: [] });

    const deliveryResult = await assets.loadDelivery({
      assetId: uploaded.value.assetId,
      materialId,
    });
    expect(deliveryResult).toMatchObject({ ok: true, value: { kind: "file" } });
    if (!deliveryResult.ok || deliveryResult.value === null) {
      throw new Error("missing public object");
    }
    const delivery = deliveryResult.value;
    const publicKey = delivery.object.publicKey;
    if (publicKey === null) throw new Error("missing public object key");
    await expect(storage.read("public", publicKey)).resolves.toMatchObject({
      body,
      contentType: "text/plain",
    });

    await expect(assets.cleanupOrphans({
      graceMs: 60 * 60 * 1_000,
      isReferenced: () => Promise.resolve(false),
      now: new Date(Date.now() + 2 * 60 * 60 * 1_000),
    })).resolves.toEqual({ ok: true, value: { cleaned: 1, retained: 0 } });
    await expect(assets.loadDelivery({
      assetId: uploaded.value.assetId,
      materialId,
    })).resolves.toEqual({ ok: true, value: null });
    await expect(storage.read("public", publicKey)).resolves.toBeNull();
  });

  test("retries a storage failure with the same idempotency key and Asset identity", async () => {
    let storageUnavailable = true;
    const recoveringStorage: ObjectStorage = {
      delete: storage.delete.bind(storage),
      read: storage.read.bind(storage),
      signGet: storage.signGet.bind(storage),
      async putImmutable(input) {
        if (storageUnavailable && input.namespace === "protected") {
          throw new Error("storage unavailable");
        }
        return storage.putImmutable(input);
      },
    };
    const assets = assembleMaterialAssets({
      objectStorage: recoveringStorage,
      prisma: database.prisma,
    });
    const body = new TextEncoder().encode("Retryable attachment\n");
    const input = {
      actor: randomUUID(),
      body,
      declaredContentType: "text/plain",
      declaredSize: body.byteLength,
      expectedChecksumSha256: createHash("sha256").update(body).digest("hex"),
      filename: "retry.txt",
      idempotencyKey: "integration-storage-retry",
      kind: "file" as const,
      materialId: randomUUID(),
    };

    await expect(assets.upload(input)).resolves.toEqual({
      error: { code: "dependency_unavailable" },
      ok: false,
    });
    const failed = await database.prisma.materialAsset.findUnique({
      where: {
        materialId_uploadedBy_idempotencyKey: {
          idempotencyKey: input.idempotencyKey,
          materialId: input.materialId,
          uploadedBy: input.actor,
        },
      },
    });
    expect(failed).toMatchObject({ failureCode: "storage_failure", state: "failed" });
    if (failed === null || failed.publicObjectKey === null) {
      throw new Error("failed upload did not retain its cleanup locators");
    }
    const failedPublicObjectKey = failed.publicObjectKey;

    storageUnavailable = false;
    const retried = await assets.upload(input);
    expect(retried).toMatchObject({
      ok: true,
      value: { assetId: failed.id, state: "ready" },
    });
    await expect(database.prisma.materialAsset.count({
      where: {
        idempotencyKey: input.idempotencyKey,
        materialId: input.materialId,
        uploadedBy: input.actor,
      },
    })).resolves.toBe(1);
    await expect(storage.read("public", failedPublicObjectKey)).resolves.toBeNull();
    await expect(assets.cleanupOrphans({
      graceMs: 0,
      isReferenced: () => Promise.resolve(false),
    })).resolves.toMatchObject({ ok: true, value: { cleaned: 1 } });
  });

  test("cleanup cannot claim a storage failure after its retry wins the row race", async () => {
    let storageUnavailable = true;
    const recoveringStorage: ObjectStorage = {
      delete: storage.delete.bind(storage),
      read: storage.read.bind(storage),
      signGet: storage.signGet.bind(storage),
      async putImmutable(input) {
        if (storageUnavailable && input.namespace === "protected") {
          throw new Error("storage unavailable");
        }
        return storage.putImmutable(input);
      },
    };
    const assets = assembleMaterialAssets({
      objectStorage: recoveringStorage,
      prisma: database.prisma,
    });
    const body = new TextEncoder().encode("Concurrent retry attachment\n");
    const input = {
      actor: randomUUID(),
      body,
      declaredContentType: "text/plain",
      declaredSize: body.byteLength,
      expectedChecksumSha256: createHash("sha256").update(body).digest("hex"),
      filename: "concurrent-retry.txt",
      idempotencyKey: "integration-storage-retry-cleanup-race",
      kind: "file" as const,
      materialId: randomUUID(),
    };

    await expect(assets.upload(input)).resolves.toEqual({
      error: { code: "dependency_unavailable" },
      ok: false,
    });
    const failed = await database.prisma.materialAsset.findUnique({
      where: {
        materialId_uploadedBy_idempotencyKey: {
          idempotencyKey: input.idempotencyKey,
          materialId: input.materialId,
          uploadedBy: input.actor,
        },
      },
    });
    if (failed === null) throw new Error("failed upload was not persisted");

    const lockReady = deferredSignal();
    const releaseLock = deferredSignal();
    const lockTransaction = database.prisma.$transaction(async (transaction) => {
      materialAssetLockRowsSchema.parse(
        await transaction.$queryRaw(Prisma.sql`
          select id
          from assets.material_assets
          where id = ${failed.id}::uuid
          for update
        `),
      );
      lockReady.resolve();
      await releaseLock.promise;
    }, { timeout: 10_000 });
    void lockTransaction.catch(lockReady.reject);
    await lockReady.promise;

    storageUnavailable = false;
    const retriedPromise = assets.upload(input);
    await waitForMaterialAssetLockWaiters(1);
    const cleanupPromise = assets.cleanupOrphans({
      graceMs: 0,
      isReferenced: () => Promise.resolve(false),
      now: new Date(Date.now() + 60 * 60 * 1_000),
    });
    await waitForMaterialAssetLockWaiters(2);
    releaseLock.resolve();
    await lockTransaction;

    const [retried, cleanup] = await Promise.all([retriedPromise, cleanupPromise]);
    expect(retried).toMatchObject({
      ok: true,
      value: { assetId: failed.id, state: "ready" },
    });
    expect(cleanup).toEqual({ ok: true, value: { cleaned: 0, retained: 0 } });
    await expect(database.prisma.materialAsset.findUnique({
      where: { id: failed.id },
    })).resolves.toMatchObject({ failureCode: null, state: "ready" });
    await expect(assets.cleanupOrphans({
      graceMs: 0,
      isReferenced: () => Promise.resolve(false),
      now: new Date(Date.now() + 2 * 60 * 60 * 1_000),
    })).resolves.toMatchObject({ ok: true, value: { cleaned: 1 } });
  }, 20_000);

  test("replaces an image through Material application facets and cleans only the old Asset", async () => {
    const assets = assembleMaterialAssets({ objectStorage: storage, prisma: database.prisma });
    const actor = randomUUID();
    const materials = assembleMaterials({
      authorPolicy: { canManage: (accountId) => accountId === actor },
      materialAssets: assets,
      prisma: database.prisma,
    });
    const metadata = {
      access: "free" as const,
      formatId: null,
      seriesIds: [],
      summary: null,
      tagIds: [],
      title: null,
      topicId: null,
    };
    const created = await materials.authoring.createDraft({
      actor,
      body: {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [{
            type: "paragraph",
            attrs: { nodeId: randomUUID() },
            content: [{ type: "text", text: "Initial body" }],
          }],
        },
      },
      idempotencyKey: "integration-asset-draft",
      metadata,
    });
    if (!created.ok) throw new Error(created.error.code);
    const materialId = created.value.materialId;
    const image = await sharp({
      create: {
        background: { alpha: 1, b: 80, g: 70, r: 60 },
        channels: 4,
        height: 320,
        width: 640,
      },
    }).jpeg().withExif({ IFD0: { Artist: "must be stripped" } }).toBuffer();
    const upload = (idempotencyKey: string) => assets.upload({
      actor,
      body: image,
      declaredContentType: "image/jpeg",
      declaredSize: image.byteLength,
      expectedChecksumSha256: createHash("sha256").update(image).digest("hex"),
      filename: "architecture.jpg",
      idempotencyKey,
      kind: "image",
      materialId,
    });
    const original = await upload("integration-image-original");
    expect(original).toMatchObject({ ok: true, value: { kind: "image", state: "ready" } });
    if (!original.ok) throw new Error("original image upload failed");

    const savedOriginal = await materials.authoring.saveMaterial({
      actor,
      body: imageBody(original.value.assetId, "Original architecture"),
      expectedContentVersion: created.value.contentVersion,
      idempotencyKey: "integration-asset-original-save",
      materialId,
      metadata,
      publicationState: "draft",
    });
    expect(savedOriginal).toMatchObject({ ok: true, value: { contentVersion: 2 } });
    if (!savedOriginal.ok) throw new Error(savedOriginal.error.code);
    await expect(materials.materialContent.containsAssetReference({
      assetId: original.value.assetId,
      checkedContentVersion: savedOriginal.value.contentVersion,
      materialId,
    })).resolves.toEqual({ ok: true, value: true });

    const replacement = await upload("integration-image-replacement");
    expect(replacement).toMatchObject({ ok: true, value: { kind: "image", state: "ready" } });
    if (!replacement.ok) throw new Error("replacement image upload failed");
    expect(replacement.value.assetId).not.toBe(original.value.assetId);
    expect(replacement.value.variants?.map(({ width }) => width)).toEqual([480, 640]);

    const savedReplacement = await materials.authoring.saveMaterial({
      actor,
      body: imageBody(replacement.value.assetId, "Current architecture"),
      expectedContentVersion: savedOriginal.value.contentVersion,
      idempotencyKey: "integration-asset-replacement-save",
      materialId,
      metadata,
      publicationState: "draft",
    });
    expect(savedReplacement).toMatchObject({ ok: true, value: { contentVersion: 3 } });
    if (!savedReplacement.ok) throw new Error(savedReplacement.error.code);
    const removedBoundary = await database.prisma.materialAsset.findUnique({
      select: { currentlyReferenced: true, orphanedAt: true },
      where: { id: original.value.assetId },
    });
    expect(removedBoundary).toMatchObject({ currentlyReferenced: false });
    if (removedBoundary === null) throw new Error("removed image Asset was not persisted");
    await expect(database.prisma.materialAsset.findUnique({
      select: { currentlyReferenced: true },
      where: { id: replacement.value.assetId },
    })).resolves.toEqual({ currentlyReferenced: true });

    const repeatedSave = await materials.authoring.saveMaterial({
      actor,
      body: imageBody(replacement.value.assetId, "Current architecture"),
      expectedContentVersion: savedReplacement.value.contentVersion,
      idempotencyKey: "integration-asset-replacement-repeat-save",
      materialId,
      metadata,
      publicationState: "draft",
    });
    expect(repeatedSave).toMatchObject({ ok: true, value: { contentVersion: 4 } });
    if (!repeatedSave.ok) throw new Error(repeatedSave.error.code);
    await expect(database.prisma.materialAsset.findUnique({
      select: { currentlyReferenced: true, orphanedAt: true },
      where: { id: original.value.assetId },
    })).resolves.toEqual(removedBoundary);
    await expect(Promise.all([
      materials.materialContent.containsAssetReference({
        assetId: original.value.assetId,
        checkedContentVersion: repeatedSave.value.contentVersion,
        materialId,
      }),
      materials.materialContent.containsAssetReference({
        assetId: replacement.value.assetId,
        checkedContentVersion: repeatedSave.value.contentVersion,
        materialId,
      }),
    ])).resolves.toEqual([
      { ok: true, value: false },
      { ok: true, value: true },
    ]);

    await expect(assets.loadDelivery({
      assetId: replacement.value.assetId,
      materialId,
    })).resolves.toEqual({ ok: true, value: null });
    const variantResult = await assets.loadDelivery({
      assetId: replacement.value.assetId,
      materialId,
      variantWidth: 480,
    });
    expect(variantResult).toMatchObject({
      ok: true,
      value: { contentType: "image/webp", kind: "image" },
    });
    if (!variantResult.ok || variantResult.value === null) {
      throw new Error("missing image variant");
    }
    const variant = variantResult.value;
    const variantPublicKey = variant.object.publicKey;
    if (variantPublicKey === null) throw new Error("missing image variant key");
    const publicBytes = await storage.read("public", variantPublicKey);
    expect(publicBytes).toMatchObject({ contentType: "image/webp", contentLength: variant.size });
    if (publicBytes === null) throw new Error("missing public image bytes");
    expect((await sharp(publicBytes.body).metadata()).exif).toBeUndefined();

    const orphanGraceMs = 250;
    const cleanupAt = async (now: Date) => assets.cleanupOrphans({
      graceMs: orphanGraceMs,
      async isReferenced(input) {
        const referenced = await materials.materialContent.containsAssetReference(input);
        if (!referenced.ok) throw new Error(referenced.error.code);
        return referenced.value;
      },
      now,
    });
    const beforeGrace = new Date(
      removedBoundary.orphanedAt.getTime() + orphanGraceMs - 1,
    );
    await expect(cleanupAt(beforeGrace)).resolves.toMatchObject({
      ok: true,
      value: { cleaned: 0 },
    });
    await expect(assets.loadDelivery({
      assetId: original.value.assetId,
      materialId,
      variantWidth: 480,
    })).resolves.toMatchObject({
      ok: true,
      value: { assetId: original.value.assetId },
    });
    const afterGrace = new Date(
      beforeGrace.getTime() + orphanGraceMs + 1,
    );
    await expect(cleanupAt(afterGrace)).resolves.toEqual({
      ok: true,
      value: { cleaned: 1, retained: 1 },
    });
    await expect(assets.loadDelivery({
      assetId: original.value.assetId,
      materialId,
      variantWidth: 480,
    })).resolves.toEqual({ ok: true, value: null });
    await expect(assets.loadDelivery({
      assetId: replacement.value.assetId,
      materialId,
      variantWidth: 480,
    })).resolves.toMatchObject({
      ok: true,
      value: { assetId: replacement.value.assetId },
    });
  });
});

function imageBody(assetId: string, alt: string) {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [{
        type: "assetImage",
        attrs: {
          alt,
          assetId,
          caption: null,
          nodeId: randomUUID(),
        },
      }],
    },
  };
}

function deferredSignal() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitForMaterialAssetLockWaiters(minimum: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = materialAssetLockWaiterRowsSchema.parse(
      await database.prisma.$queryRaw(Prisma.sql`
        select count(*)::integer as waiting
        from pg_stat_activity
        where datname = current_database()
          and cardinality(pg_blocking_pids(pid)) > 0
          and query ilike '%material_assets%'
      `),
    );
    if ((rows[0]?.waiting ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${minimum} MaterialAsset row-lock waiter(s)`);
}
