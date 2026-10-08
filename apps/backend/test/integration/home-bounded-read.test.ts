import { accountId } from "../../src/modules/accounts/index.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { afterAll, beforeAll, expect, test } from "vitest";
import { PrismaClient } from "../../src/infrastructure/prisma/generated/client.js";
import { createPrismaPgAdapter } from "../../src/infrastructure/prisma/prisma-adapter.js";
import type { Prisma } from "../../src/infrastructure/prisma/index.js";
import {
  assembleMaterials,
  assembleMaterialResourceFacts,
} from "../../src/modules/materials/index.js";
import { readHomeContent } from "../../src/modules/content-library/features/read-home-content/read-home-content.js";
import { assembleVideos } from "../../src/modules/videos/facets/videos/assemble-videos.js";
import { readLegacyHomeContent } from "../support/legacy-home-content.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(900000);
const product = id(800000);
let corpora: Awaited<ReturnType<typeof createCorpus>>[];

async function createCorpus() {
  const database = await createMigratedTestDatabase();
  const prisma = new PrismaClient({
    adapter: createPrismaPgAdapter(database.url),
    log: [{ emit: "event", level: "query" }],
  });
  let queryCount = 0;
  let measuring = false;
  prisma.$on("query", () => {
    if (measuring) queryCount += 1;
  });
  return {
    prisma,
    materials: assembleMaterials({
      prisma,
      authorPolicy: { canManage: () => false },
    }),
    start() {
      queryCount = 0;
      measuring = true;
    },
    stop() {
      measuring = false;
      return queryCount;
    },
    async dispose() {
      await prisma.$disconnect();
      await database.dispose();
    },
  };
}

beforeAll(async () => {
  corpora = [];
  // Each test owns its mutable database. Build both large corpora before measurements start.
  for (const size of [90, 9000, 90]) {
    const corpus = await createCorpus();
    corpora.push(corpus);
    await corpus.prisma.account.create({
      data: {
        id: actor,
        logtoIssuer: "https://home.invalid",
        logtoSubject: "home",
      },
    });
    await corpus.prisma.product.create({
      data: { id: product, name: "Z-main", slug: "main", summary: "fixed" },
    });
    await seed(corpus.prisma, 0, size);
  }
});
afterAll(async () => {
  await Promise.all(corpora.map((corpus) => corpus.dispose()));
});

async function seed(prisma: PrismaClient, start: number, end: number) {
  const topics: Prisma.TopicCreateManyInput[] = [];
  const products: Prisma.ProductCreateManyInput[] = [];
  const items: Prisma.MaterialCreateManyInput[] = [];
  const publications: Prisma.PublishedMaterialCreateManyInput[] = [];
  const memberships: Prisma.ProductMembershipCreateManyInput[] = [];
  const publishedMemberships: Prisma.PublishedMaterialProductMembershipCreateManyInput[] =
    [];
  const videos: Prisma.VideoCreateManyInput[] = [];
  for (let n = start; n < end; n += 1) {
    const group = Math.floor(n / 9);
    const materialId = id(n + 1);
    const topicId = id(100000 + group);
    const seriesId = id(200000 + group);
    const videoId = id(300000 + n);
    const formatId =
      ["video", "guide", "note"][Math.floor((n % 9) / 3)] ?? "note";
    if (n % 9 === 0) {
      topics.push({
        id: topicId,
        name: `Topic-${String(group).padStart(4, "0")}`,
        slug: `topic-${group}`,
      });
      products.push({
        id: seriesId,
        name: `Series-${String(group).padStart(4, "0")}`,
        slug: `series-${group}`,
        summary: "fixed",
      });
    }
    const publishedAt = new Date(Date.UTC(2026, 0, 1) - n * 1000);
    const metadata = {
      slug: `material-${n}`,
      title: `Material ${n}`,
      summary: "fixed",
      topicId,
      formatId,
      access: "free",
      contentVersion: 1n,
      publishedAt,
      publishedBy: actor,
      primaryVideoId: formatId === "video" ? videoId : null,
    };
    items.push({
      ...metadata,
      id: materialId,
      schemaVersion: 1,
      body: { type: "doc", content: [] },
      createdBy: actor,
      publicationState: "published",
      firstPublishedAt: publishedAt,
    });
    publications.push({ ...metadata, materialId, publicSearchText: "fixed" });
    for (const [groupId, ordinal] of [
      [seriesId, (n % 9) + 1],
      [product, n + 1],
    ] as const) {
      memberships.push({ materialId, seriesId: groupId, ordinal });
      publishedMemberships.push({ materialId, seriesId: groupId, ordinal });
    }
    if (formatId === "video")
      videos.push({
        id: videoId,
        materialId,
        createdBy: actor,
        access: "free",
        projectId: "free",
        providerVideoId: `v-${n}`,
        title: "fixed",
        origin: "platform_upload",
        providerStatus: "ready",
        state: "ready",
        durationSeconds: 120,
        providerEmbedLocator: "https://video.invalid/embed",
        readyAt: new Date("2026-01-01"),
      });
  }
  // Prepare the corpus before observing Home; bounded batches also keep bind parameters below PostgreSQL's limit.
  for (let offset = 0; offset < items.length; offset += 300) {
    await prisma.topic.createMany({ data: topics.slice(offset, offset + 300) });
    await prisma.product.createMany({
      data: products.slice(offset, offset + 300),
    });
    await prisma.material.createMany({
      data: items.slice(offset, offset + 300),
    });
    await prisma.video.createMany({ data: videos.slice(offset, offset + 300) });
    await prisma.publishedMaterial.createMany({
      data: publications.slice(offset, offset + 300),
    });
  }
  for (let offset = 0; offset < memberships.length; offset += 300) {
    await prisma.productMembership.createMany({
      data: memberships.slice(offset, offset + 300),
    });
    await prisma.publishedMaterialProductMembership.createMany({
      data: publishedMemberships.slice(offset, offset + 300),
    });
  }
}

function catalogVideos(prisma: PrismaClient) {
  return assembleVideos({
    prisma,
    canManage: () => Promise.resolve(false),
    projects: { free: "free", closed: "closed" },
    provider: {
      initUpload: () => Promise.reject(new Error("unused")),
      delete: () => Promise.reject(new Error("unused")),
      find: () => Promise.reject(new Error("unused")),
    },
  });
}

// One case owns both corpora; each legacy read occurs outside the query measurement.
test("Home keeps the legacy DTO on 90 and 9000 materials with a constant SQL budget and at most 39 unique enrichments", async () => {
  const counts: number[] = [];
  const results: unknown[] = [];
  for (const corpus of corpora.slice(0, 2)) {
    const { prisma, materials } = corpus;
    const enriched: string[] = [];
    const access = {
      async checkAvailabilityMany(
        input: Parameters<
          typeof materials.contentAccess.checkAvailabilityMany
        >[0],
      ) {
        enriched.push(...input.operations.map((operation) => operation.itemId));
        return materials.contentAccess.checkAvailabilityMany(input);
      },
    };
    const videos = catalogVideos(prisma);
    const rights = {
      resolveForAccess: () => Promise.resolve({ kind: "required" as const }),
    };
    const subject = { kind: "anonymous" as const };
    const expected = await readLegacyHomeContent(
      materials.publishedMaterialReader,
      materials.contentAccess,
      videos,
      rights,
      false,
      subject,
    );
    corpus.start();
    let result;
    let count;
    try {
      result = await readHomeContent(
        materials.publishedMaterialReader,
        access,
        videos,
        rights,
        false,
        subject,
      );
    } finally {
      count = corpus.stop();
    }
    expect(result).toEqual(expected);
    expect(result.ok).toBe(true);
    expect(enriched.length).toBeLessThanOrEqual(39);
    expect(new Set(enriched).size).toBe(enriched.length);
    expect(count).toBeLessThanOrEqual(20);
    counts.push(count);
    results.push(result);
  }
  expect(counts[1]).toBe(counts[0]);
  expect(results[1]).toEqual(results[0]);
});

test("Home preserves membership, feed filters, archived and empty groups, covers and a pin outside the first four Playlists", async () => {
  const corpus = corpora[2];
  if (corpus === undefined) throw new Error("Missing scenario corpus");
  const { prisma, materials } = corpus;
  const seriesId = id(200008);
  const coverId = id(700000);
  await prisma.contentCover.create({
    data: {
      id: coverId,
      seriesId,
      state: "ready",
      currentlyReferenced: true,
      renditions: {
        create: {
          width: 320,
          height: 180,
          contentType: "image/webp",
          byteSize: 12,
          checksumSha256: "a".repeat(64),
          publicObjectKey: "home-cover.webp",
        },
      },
    },
  });
  await prisma.product.update({
    where: { id: seriesId },
    data: {
      coverId,
      presentation: "ai-engineering-course",
      page: {
        card: { eyebrow: "Course", subtitle: "Learn", action: "Open" },
        blocks: [
          {
            id: "hero",
            kind: "hero",
            badge: "Inside",
            lead: "Home hero",
            highlights: ["Learn"],
          },
        ],
      },
    },
  });
  await prisma.homeSeriesPin.update({ where: { id: 1 }, data: { seriesId } });
  await prisma.product.create({
    data: { id: id(600000), name: "A-empty", slug: "empty" },
  });
  await prisma.topic.create({
    data: { id: id(600001), name: "A-empty", slug: "empty" },
  });
  await prisma.topic.update({
    where: { id: id(100000) },
    data: { archivedAt: new Date("2026-01-02") },
  });
  await prisma.product.update({
    where: { id: id(200000) },
    data: { archivedAt: new Date("2026-01-02") },
  });
  // Closed and hidden free Materials remain in counts and previews, but never in the Home feed.
  await prisma.material.update({
    where: { id: id(2) },
    data: { access: "closed" },
  });
  await prisma.publishedMaterial.update({
    where: { materialId: id(2) },
    data: { access: "closed" },
  });
  await prisma.material.update({
    where: { id: id(4) },
    data: { showInFeed: false },
  });
  // A public note outside the first four Playlists is still a legacy feed preview.
  await prisma.materialSearchDocument.createMany({
    data: [
      {
        materialId: id(7),
        contentVersion: 1n,
        plainText: "Visible note excerpt",
      },
      {
        materialId: id(52),
        contentVersion: 1n,
        plainText: "Preview note excerpt",
      },
    ],
  });
  await prisma.publishedMaterialProductMembership.update({
    where: {
      materialId_seriesId: { materialId: id(46), seriesId: id(200005) },
    },
    data: { ordinal: 100 },
  });
  await prisma.publishedMaterialProductMembership.update({
    where: {
      materialId_seriesId: { materialId: id(52), seriesId: id(200005) },
    },
    data: { ordinal: 1 },
  });
  await prisma.material.update({
    where: { id: id(52) },
    data: { publishedAt: new Date("2026-01-03") },
  });
  await prisma.publishedMaterial.update({
    where: { materialId: id(52) },
    data: { publishedAt: new Date("2026-01-03") },
  });
  const videos = catalogVideos(prisma);
  for (const kind of [
    "active",
    "required",
    "expired",
    "stale",
    "unavailable",
  ] as const) {
    const rights = {
      resolveForAccess: () =>
        Promise.resolve(
          kind === "active" ? { kind, validUntil: null } : { kind },
        ),
    };
    const access = assembleContentAccess({
      materialResourceFacts: assembleMaterialResourceFacts(
        materials.materialContent,
      ),
      accountPermissions: { hasMaterialsManage: () => Promise.resolve(false) },
      accountRights: rights,
    });
    const subject = { kind: "account" as const, accountId: accountId(actor) };
    const result = await readHomeContent(
      materials.publishedMaterialReader,
      access,
      videos,
      rights,
      true,
      subject,
    );
    expect(result).toEqual(
      await readLegacyHomeContent(
        materials.publishedMaterialReader,
        access,
        videos,
        rights,
        true,
        subject,
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        membership: {
          kind:
            kind === "active"
              ? "active"
              : kind === "stale" || kind === "unavailable"
                ? "unknown"
                : "inactive",
        },
        pinnedSeries: {
          id: seriesId,
          count: 9,
          presentation: "ai-engineering-course",
          card: { eyebrow: "Course", subtitle: "Learn", action: "Open" },
          hero: { badge: "Inside", lead: "Home hero", highlights: ["Learn"] },
          cover: { coverId, renditions: [{ width: 320, height: 180 }] },
          previewItems: [
            expect.objectContaining({ materialId: id(73) }),
            expect.objectContaining({ materialId: id(74) }),
            expect.objectContaining({ materialId: id(75) }),
          ],
        },
      },
    });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.playlists.map((item) => item.id)).toEqual([
      id(200001),
      id(200002),
      id(200003),
      id(200004),
    ]);
    expect(result.value.videos.map((item) => item.materialId)).not.toContain(
      id(2),
    );
    expect(result.value.guides.map((item) => item.materialId)).not.toContain(
      id(4),
    );
  }
  const rights = {
    resolveForAccess: () => Promise.resolve({ kind: "required" as const }),
  };
  const subject = { kind: "anonymous" as const };
  // The same pin also appears among Playlists after reordering; enrichment remains unique.
  await prisma.product.update({
    where: { id: seriesId },
    data: { name: "A-pin" },
  });
  const enriched: string[] = [];
  const access = {
    async checkAvailabilityMany(
      input: Parameters<
        typeof materials.contentAccess.checkAvailabilityMany
      >[0],
    ) {
      enriched.push(...input.operations.map((operation) => operation.itemId));
      return materials.contentAccess.checkAvailabilityMany(input);
    },
  };
  expect(
    await readHomeContent(
      materials.publishedMaterialReader,
      access,
      videos,
      rights,
      false,
      subject,
    ),
  ).toEqual(
    await readLegacyHomeContent(
      materials.publishedMaterialReader,
      materials.contentAccess,
      videos,
      rights,
      false,
      subject,
    ),
  );
  expect(enriched.length).toBeLessThanOrEqual(39);
  expect(new Set(enriched).size).toBe(enriched.length);
  await prisma.product.update({
    where: { id: seriesId },
    data: { archivedAt: new Date("2026-01-02") },
  });
  expect(
    await readHomeContent(
      materials.publishedMaterialReader,
      materials.contentAccess,
      videos,
      rights,
      false,
      subject,
    ),
  ).toMatchObject({ ok: true, value: { pinnedSeries: null } });
  await prisma.product.update({
    where: { id: seriesId },
    data: { archivedAt: null },
  });
  await prisma.publishedMaterial.deleteMany({
    where: {
      materialId: { in: Array.from({ length: 9 }, (_, n) => id(73 + n)) },
    },
  });
  expect(
    await readHomeContent(
      materials.publishedMaterialReader,
      materials.contentAccess,
      videos,
      rights,
      false,
      subject,
    ),
  ).toMatchObject({ ok: true, value: { pinnedSeries: null } });
  // A visible enrichment dependency retains its public failure contract.
  expect(
    await readHomeContent(
      materials.publishedMaterialReader,
      materials.contentAccess,
      {
        loadReadyDurations: () =>
          Promise.resolve({
            ok: false,
            error: { code: "dependency_unavailable", retryable: true },
          }),
      },
      rights,
      false,
      subject,
    ),
  ).toEqual({
    ok: false,
    error: { code: "dependency_unavailable", retryable: true },
  });
  expect(
    await readHomeContent(
      materials.publishedMaterialReader,
      {
        checkAvailabilityMany: () =>
          Promise.resolve({ ok: false, error: { code: "empty_batch" } }),
      },
      videos,
      rights,
      false,
      subject,
    ),
  ).toMatchObject({
    ok: false,
    error: { code: "internal_error" },
  });
  expect(
    await readHomeContent(
      materials.publishedMaterialReader,
      materials.contentAccess,
      videos,
      rights,
      false,
      { ...subject, unexpected: true } as typeof subject,
    ),
  ).toEqual({ ok: false, error: { code: "invalid_request_shape" } });
  await prisma.homeSeriesPin.delete({ where: { id: 1 } });
  const broken = await readHomeContent(
    materials.publishedMaterialReader,
    materials.contentAccess,
    videos,
    rights,
    false,
    subject,
  );
  expect(broken).toMatchObject({
    ok: false,
    error: { code: "internal_error" },
  });
  expect(
    await readLegacyHomeContent(
      materials.publishedMaterialReader,
      materials.contentAccess,
      videos,
      rights,
      false,
      subject,
    ),
  ).toMatchObject(
    broken.ok ? broken : { ok: false, error: { code: broken.error.code } },
  );
});
