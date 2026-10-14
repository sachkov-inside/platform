import { afterAll, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { declaredServer } from "../support/declared-api.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import { listPublishedMaterials } from "../../src/modules/content-library/index.js";
import { listPublicSiteIndex } from "../../src/modules/content-library/features/list-public-site-index/list-public-site-index.js";
import { createQueryEventClient } from "./setup/query-events.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
let measured: ReturnType<typeof createQueryEventClient>;
const id = (ordinal: number) =>
  `45000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
const publishedAt = new Date("2026-10-01T00:00:00.000Z");
beforeAll(async () => {
  database = await createMigratedTestDatabase();
  await database.prisma.topic.createMany({
    data: [
      { id: id(1001), slug: "index-topic", name: "Index topic" },
      { id: id(1002), slug: "empty-topic", name: "Empty" },
      {
        id: id(1003),
        slug: "archived-topic",
        name: "Archived",
        archivedAt: publishedAt,
      },
    ],
  });
  await database.prisma.product.createMany({
    data: [
      { id: id(2001), slug: "index-product", name: "Index product" },
      { id: id(2002), slug: "empty-product", name: "Empty" },
      {
        id: id(2003),
        slug: "archived-product",
        name: "Archived",
        archivedAt: publishedAt,
      },
    ],
  });
  const facts = Array.from({ length: 205 }, (_, index) => ({
    slug: `index-material-${String(index + 1)}`,
    title: `Material ${String(index + 1)}`,
    summary: "Index fixture",
    access: index % 2 === 0 ? "free" : "closed",
    topicId: id(index === 204 ? 1003 : 1001),
    formatId: "note",
    contentVersion: 1n,
    publishedAt,
    publishedBy: id(3001),
  }));
  await database.prisma.material.createMany({
    data: facts.map((fact, index) => ({
      ...fact,
      id: id(index + 1),
      createdBy: id(3001),
      schemaVersion: 1,
      body: { type: "doc", content: [] },
      publicationState: "published",
      firstPublishedAt: publishedAt,
    })),
  });
  await database.prisma.publishedMaterial.createMany({
    data: facts.map((fact, index) => ({
      ...fact,
      materialId: id(index + 1),
      publicSearchText: "Index fixture",
    })),
  });
  await database.prisma.publishedMaterialProductMembership.createMany({
    data: [
      { materialId: id(1), seriesId: id(2001), ordinal: 1 },
      { materialId: id(2), seriesId: id(2003), ordinal: 1 },
    ],
  });
  measured = createQueryEventClient(database.url);
});
afterAll(async () => {
  await measured.prisma.$disconnect();
  await database.dispose();
});

test("site traversal preserves the complete public catalog addresses while reading metadata only initially", async () => {
  const materials = assembleMaterials({
    prisma: measured.prisma,
    authorPolicy: { canManage: () => false },
  });
  let baselineAvailabilityCalls = 0;
  let baselineVideoCalls = 0;
  const baseline = await measured.measure(async () => {
    const slugs: string[] = [];
    let bytes = 0;
    let calls = 0;
    let after: string | undefined;
    for (;;) {
      calls++;
      const page = await listPublishedMaterials(
        materials.publishedMaterialReader,
        {
          checkAvailabilityMany: (query) => {
            baselineAvailabilityCalls++;
            return materials.contentAccess.checkAvailabilityMany(query);
          },
        },
        {
          loadReadyDurations: () => {
            baselineVideoCalls++;
            return Promise.resolve({ ok: true as const, value: [] });
          },
        },
        {
          subject: { kind: "anonymous" },
          first: 24,
          ...(after === undefined ? {} : { after }),
        },
      );
      if (!page.ok) throw new Error(page.error.code);
      bytes += Buffer.byteLength(JSON.stringify(page.value));
      slugs.push(...page.value.items.map(({ slug }) => slug));
      expect(page.value.totalCount).toBe(205);
      expect(page.value.facets.topics.map(({ slug }) => slug)).toEqual([
        "index-topic",
      ]);
      expect(page.value.facets.series.map(({ slug }) => slug)).toEqual([
        "index-product",
      ]);
      if (page.value.nextCursor === null) break;
      after = page.value.nextCursor;
    }
    return { slugs, bytes, calls };
  });
  const optimized = await measured.measure(async () => {
    const slugs: string[] = [];
    let bytes = 0;
    let calls = 0;
    let after: string | undefined;
    for (;;) {
      calls++;
      const page = await listPublicSiteIndex(
        materials.publishedMaterialReader,
        { first: 24, ...(after === undefined ? {} : { after }) },
      );
      if (!page.ok) throw new Error(page.error.code);
      bytes += Buffer.byteLength(JSON.stringify(page.value));
      slugs.push(...page.value.items.map(({ slug }) => slug));
      expect(page.value.topicSlugs).toEqual(
        after === undefined ? ["index-topic"] : [],
      );
      expect(page.value.productSlugs).toEqual(
        after === undefined ? ["index-product"] : [],
      );
      expect(Object.keys(page.value.items[0] ?? {}).sort()).toEqual([
        "publishedAt",
        "slug",
      ]);
      if (page.value.nextCursor === null) break;
      after = page.value.nextCursor;
    }
    return { slugs, bytes, calls };
  });
  expect(optimized.result.slugs).toEqual(baseline.result.slugs);
  expect(new Set(optimized.result.slugs).size).toBe(205);
  expect(optimized.result.calls).toBe(9);
  expect(optimized.statements).toHaveLength(11);
  expect(optimized.result.bytes).toBeLessThan(baseline.result.bytes);
  expect(optimized.statements.length).toBeLessThan(baseline.statements.length);
  process.stdout.write(
    "PC5 measured, seed excluded " +
      JSON.stringify({
        baseline: {
          ownerCalls: {
            materials: baseline.result.calls,
            contentAccess: baselineAvailabilityCalls,
            videos: baselineVideoCalls,
          },
          sql: baseline.statements.length,
          responseBytes: baseline.result.bytes,
        },
        siteIndex: {
          ownerCalls: {
            materials: optimized.result.calls,
            contentAccess: 0,
            videos: 0,
          },
          sql: optimized.statements.length,
          responseBytes: optimized.result.bytes,
        },
        providerRequests: 0,
      }) +
      "\n",
  );
  const invalid = await listPublicSiteIndex(materials.publishedMaterialReader, {
    first: 24,
    after: Buffer.from(
      JSON.stringify({
        v: 1,
        fingerprint: "other",
        materialId: id(1),
        publishedAt: publishedAt.toISOString(),
      }),
    ).toString("base64url"),
  });
  expect(invalid).toEqual({
    ok: false,
    error: { code: "invalid_request_shape" },
  });
});

test("a new initial traversal observes publication changes without shared metadata cache", async () => {
  const materials = assembleMaterials({
    prisma: measured.prisma,
    authorPolicy: { canManage: () => false },
  });
  const before = await listPublicSiteIndex(materials.publishedMaterialReader, {
    first: 200,
  });
  expect(before.ok).toBe(true);
  await database.prisma.product.update({
    where: { id: id(2001) },
    data: { archivedAt: publishedAt },
  });
  try {
    const after = await listPublicSiteIndex(materials.publishedMaterialReader, {
      first: 200,
    });
    expect(after.ok && after.value.productSlugs).toEqual([]);
  } finally {
    await database.prisma.product.update({
      where: { id: id(2001) },
      data: { archivedAt: null },
    });
  }
});

test("unpublishing is visible on the next traversal and collection metadata", async () => {
  const materials = assembleMaterials({
    prisma: measured.prisma,
    authorPolicy: { canManage: () => false },
  });
  const publication = await database.prisma.publishedMaterial.findUniqueOrThrow(
    { where: { materialId: id(1) } },
  );
  await database.prisma.publishedMaterialProductMembership.delete({
    where: { materialId_seriesId: { materialId: id(1), seriesId: id(2001) } },
  });
  await database.prisma.publishedMaterial.delete({
    where: { materialId: id(1) },
  });
  try {
    const initial = await listPublicSiteIndex(
      materials.publishedMaterialReader,
      { first: 200 },
    );
    expect(initial.ok && initial.value.productSlugs).toEqual([]);
    if (!initial.ok) throw new Error(initial.error.code);
    const continuation = await listPublicSiteIndex(
      materials.publishedMaterialReader,
      { first: 200, after: initial.value.nextCursor ?? "" },
    );
    if (!continuation.ok) throw new Error(continuation.error.code);
    expect(
      [...initial.value.items, ...continuation.value.items].map(
        ({ slug }) => slug,
      ),
    ).not.toContain("index-material-1");
    expect([...initial.value.items, ...continuation.value.items]).toHaveLength(
      204,
    );
  } finally {
    await database.prisma.publishedMaterial.create({
      data: { ...publication, outcomes: [] },
    });
    await database.prisma.publishedMaterialProductMembership.create({
      data: { materialId: id(1), seriesId: id(2001), ordinal: 1 },
    });
  }
});

test("public HTTP traversal returns 200-row pages, retryable continuation and rejects foreign cursors", async () => {
  const app = await createApiApplication(
    parsePlatformConfig({ NODE_ENV: "test", DATABASE_URL: database.url }),
    { logger: false },
  );
  try {
    await app.init();
    const server = declaredServer(app.getHttpAdapter().getInstance());
    await server.ready();
    let catalogAfter: string | null = null;
    let catalogRequests = 0;
    let catalogBytes = 0;
    for (;;) {
      const response = await server.inject({
        method: "GET",
        url: `/library/materials${catalogAfter === null ? "" : `?after=${encodeURIComponent(catalogAfter)}`}`,
      });
      expect(response.statusCode).toBe(200);
      catalogRequests++;
      catalogBytes += Buffer.byteLength(response.body);
      const body = z
        .object({ nextCursor: z.string().nullable() })
        .parse(response.json());
      if (body.nextCursor === null) break;
      catalogAfter = body.nextCursor;
    }
    const first = await server.inject({
      method: "GET",
      url: "/library/site-index",
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe(
      "public, max-age=30, stale-while-revalidate=60",
    );
    const pageSchema = z.object({
      items: z.array(z.object({ slug: z.string(), publishedAt: z.string() })),
      productSlugs: z.array(z.string()),
      topicSlugs: z.array(z.string()),
      nextCursor: z.string().nullable(),
    });
    const initial = pageSchema.parse(first.json());
    expect(initial.items).toHaveLength(200);
    expect(initial.productSlugs).toEqual(["index-product"]);
    expect(initial.nextCursor).not.toBeNull();
    const continuationUrl = `/library/site-index?after=${encodeURIComponent(initial.nextCursor ?? "")}`;
    const second = await server.inject({ method: "GET", url: continuationUrl });
    expect(second.statusCode).toBe(200);
    const next = pageSchema.parse(second.json());
    expect(next.items).toHaveLength(5);
    expect(next.productSlugs).toEqual([]);
    expect(next.topicSlugs).toEqual([]);
    expect(next.nextCursor).toBeNull();
    const retry = await server.inject({ method: "GET", url: continuationUrl });
    expect(retry.json()).toEqual(second.json());
    const invalid = await server.inject({
      method: "GET",
      url: "/library/site-index?after=foreign",
    });
    expect(invalid.statusCode).toBe(400);
    const invalidShape = await server.inject({
      method: "GET",
      url: "/library/site-index?topic=index-topic",
    });
    expect(invalidShape.statusCode).toBe(400);
    process.stdout.write(
      `PC5 HTTP 205 Materials: catalogCalls=${String(catalogRequests)}, catalogBytes=${String(catalogBytes)}, siteIndexCalls=2, siteIndexBytes=${String(Buffer.byteLength(first.body) + Buffer.byteLength(second.body))}, providerRequests=0\n`,
    );
  } finally {
    await app.close();
  }
});
