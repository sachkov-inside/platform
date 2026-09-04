import { createHash } from "node:crypto";

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
