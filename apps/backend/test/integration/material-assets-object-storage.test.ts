import { createHash, randomUUID } from "node:crypto";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { MinioContainer, type StartedMinioContainer } from "@testcontainers/minio";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createS3ObjectStorage, type ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { assembleMaterialAssetMaintenance } from "../../src/modules/materials/features/cleanup-material-assets/cleanup-material-assets.js";
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

  test("replaces an image through Material application facets and cleans only the old Asset", async () => {
    const assets = assembleMaterialAssets({ objectStorage: storage, prisma: database.prisma });
    const actor = randomUUID();
    const materials = assembleMaterials({
      authorPolicy: { canManage: (accountId) => accountId === actor },
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
    await expect(Promise.all([
      materials.materialContent.containsAssetReference({
        assetId: original.value.assetId,
        checkedContentVersion: savedReplacement.value.contentVersion,
        materialId,
      }),
      materials.materialContent.containsAssetReference({
        assetId: replacement.value.assetId,
        checkedContentVersion: savedReplacement.value.contentVersion,
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

    const maintenance = assembleMaterialAssetMaintenance({
      assets,
      config: { objectStorage: { orphanGraceMs: 100 } },
      materials: materials.materialContent,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(maintenance.cleanup()).resolves.toEqual({
      cleaned: 1,
      ok: true,
      retained: 1,
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
