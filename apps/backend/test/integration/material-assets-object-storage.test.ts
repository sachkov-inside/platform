import { createHash, randomUUID } from "node:crypto";

import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { MinioContainer, type StartedMinioContainer } from "@testcontainers/minio";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createS3ObjectStorage, type ObjectStorage } from "../../src/infrastructure/object-storage/index.js";
import { assembleMaterialAssets } from "../../src/modules/assets/index.js";
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
    ).resolves.toEqual([]);

    const delivery = await assets.loadDelivery({
      assetId: uploaded.value.assetId,
      materialId,
    });
    expect(delivery?.object.publicKey).not.toBeNull();
    if (delivery?.object.publicKey === null || delivery === null) throw new Error("missing public object");
    await expect(storage.read("public", delivery.object.publicKey)).resolves.toMatchObject({
      body,
      contentType: "text/plain",
    });

    await expect(assets.cleanupOrphans({
      graceMs: 60 * 60 * 1_000,
      isReferenced: () => Promise.resolve(false),
      now: new Date(Date.now() + 2 * 60 * 60 * 1_000),
    })).resolves.toEqual({ cleaned: 1, retained: 0 });
    await expect(assets.loadDelivery({ assetId: uploaded.value.assetId, materialId })).resolves.toBeNull();
    await expect(storage.read("public", delivery.object.publicKey)).resolves.toBeNull();
  });
});
