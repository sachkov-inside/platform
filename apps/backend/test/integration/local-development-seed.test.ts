import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import {
  discoverPublishedMaterials,
  listPublishedMaterials,
} from "../../src/modules/content-library/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import { BillingPricing } from "../../src/modules/billing/index.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import {
  assembleMaterials,
} from "../../src/modules/materials/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

/** Серия, которую продаёт разовое предложение локального каталога. */
const seedGuideId = "72000000-0000-4000-8000-000000000007";

describe("local development seed", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("publishes a stable multi-page free and closed catalog when repeated", async () => {
    const first = await seedLocalDevelopment(testDatabase.prisma);
    const second = await seedLocalDevelopment(testDatabase.prisma);

    expect(second).toEqual(first);

    const { contentAccess, publishedMaterialReader } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: {
        canManage: () => false,
      },
    });
    const catalog = await listPublishedMaterials(
      publishedMaterialReader,
      contentAccess,
      emptyCatalogVideos,
      { subject: anonymousSubject, first: 12 },
    );
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) {
      throw new Error("Expected the local catalog seed to be readable");
    }
    expect(catalog.value.items).toHaveLength(12);
    expect(catalog.value.items.slice(0, 2)).toMatchObject([
      { slug: "developer-pipeline-bez-poteri-konteksta", access: "membership" },
      { slug: "kak-ustroen-inside-platform", access: "free" },
    ]);
    expect(typeof catalog.value.nextCursor).toBe("string");
    expect(await testDatabase.prisma.publishedMaterial.count()).toBe(31);
    await expect(
      testDatabase.prisma.video.findMany({
        orderBy: { providerVideoId: "asc" },
        select: { durationSeconds: true, providerVideoId: true, state: true },
      }),
    ).resolves.toEqual([
      { durationSeconds: 481, providerVideoId: "local-home-deep-modules", state: "ready" },
      { durationSeconds: 628, providerVideoId: "local-home-developer-pipeline", state: "ready" },
      { durationSeconds: 754, providerVideoId: "local-home-product-context", state: "ready" },
      { durationSeconds: 810, providerVideoId: "local-series-release-docker", state: "ready" },
      { durationSeconds: 630, providerVideoId: "local-series-release-overview", state: "ready" },
      { durationSeconds: 542, providerVideoId: "local-series-review-video", state: "ready" },
    ]);

    await expect(
      publishedMaterialReader.read({
        subject: anonymousSubject,
        slug: first.slug,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        kind: "available",
        projection: {
          materialId: first.materialId,
          contentVersion: first.contentVersion,
          title: "Как устроен Inside Platform",
        },
      },
    });

    const [harness, review, standalone] = await Promise.all([
      discoverPublishedMaterials(
        publishedMaterialReader,
        contentAccess,
        emptyCatalogVideos,
        {
          first: null,
          kind: "series",
          slug: "demo-series-harness",
          subject: anonymousSubject,
        },
      ),
      discoverPublishedMaterials(
        publishedMaterialReader,
        contentAccess,
        emptyCatalogVideos,
        {
          first: null,
          kind: "series",
          slug: "demo-series-review",
          subject: anonymousSubject,
        },
      ),
      listPublishedMaterials(
        publishedMaterialReader,
        contentAccess,
        emptyCatalogVideos,
        {
          first: 10,
          q: "standalone #295",
          subject: anonymousSubject,
        },
      ),
    ]);

    expect(harness).toMatchObject({
      ok: true,
      value: {
        items: [
          { slug: "demo-295-obshchiy-gayd" },
          { slug: "demo-295-finalnyy-gayd" },
        ],
      },
    });
    expect(review).toMatchObject({
      ok: true,
      value: {
        items: [
          { slug: "demo-295-obshchiy-gayd" },
          { slug: "demo-295-video-razbor" },
          { slug: "demo-295-itogovaya-zametka" },
        ],
      },
    });
    if (!standalone.ok) throw new Error(standalone.error.code);
    expect(standalone.value.items).toContainEqual(
      expect.objectContaining({
        seriesMemberships: [],
        slug: "demo-295-samostoyatelnaya-zametka",
      }),
    );
  });

  test("puts two subscriptions and one guide purchase on sale without a second set", async () => {
    const seed = await seedLocalDevelopment(testDatabase.prisma);
    await seedLocalDevelopment(testDatabase.prisma);

    const storefront = new BillingPricing({
      prisma: testDatabase.prisma,
      accounts: {
        checkPermission: () => Promise.resolve({ ok: true, allowed: false }),
      },
    });
    const forSale = await storefront.offers({ limit: 100 });
    if (!forSale.ok) throw new Error(forSale.error.code);
    expect(
      forSale.value.items.map((snapshot) => ({
        benefits: snapshot.offer.benefits,
        firstPriceKopecks: snapshot.firstPriceKopecks,
        mode: snapshot.paymentOption.mode,
        name: snapshot.offer.name,
        published: snapshot.offer.published,
      })),
    ).toEqual([
      {
        benefits: ["materials"],
        firstPriceKopecks: 1_000,
        mode: "subscription",
        name: "Материалы",
        published: true,
      },
      {
        benefits: ["materials", "support"],
        firstPriceKopecks: 2_000,
        mode: "subscription",
        name: "Материалы + сопровождение",
        published: true,
      },
      {
        benefits: [`guide:${seedGuideId}`],
        firstPriceKopecks: 3_000,
        mode: "one_time",
        name: "Руководство «Создание Platform Inside»",
        published: true,
      },
    ]);
    expect(seed.slug).toBe("kak-ustroen-inside-platform");
    // Повторный seed использует receipt уже применённых владельческих команд, поэтому второго
    // набора предложений и вариантов оплаты не появляется.
    await expect(testDatabase.prisma.billingOffer.count()).resolves.toBe(3);
    await expect(
      testDatabase.prisma.billingPaymentOption.count(),
    ).resolves.toBe(3);
  });

  test("keeps an offer the owner took off sale off the storefront", async () => {
    await seedLocalDevelopment(testDatabase.prisma);
    const owner = "72000000-0000-4000-8000-000000000590";
    const admin = new BillingPricing({
      prisma: testDatabase.prisma,
      accounts: {
        checkPermission: () => Promise.resolve({ ok: true, allowed: true }),
      },
    });
    const seeded = await testDatabase.prisma.billingOffer.findFirstOrThrow({
      orderBy: { id: "asc" },
      select: { id: true, revision: true },
    });
    const unpublished = await admin.manage(owner, {
      expectedRevision: seeded.revision,
      id: seeded.id,
      operation: "offers.unpublish",
      operationId: "72000000-0000-4000-8000-000000000591",
    });
    expect(unpublished.ok).toBe(true);

    await seedLocalDevelopment(testDatabase.prisma);

    const forSale = await admin.offers({ limit: 100 });
    if (!forSale.ok) throw new Error(forSale.error.code);
    expect(forSale.value.items.map((snapshot) => snapshot.offer.id)).not.toContain(
      seeded.id,
    );
    await expect(
      testDatabase.prisma.billingOffer.findUniqueOrThrow({
        select: { published: true },
        where: { id: seeded.id },
      }),
    ).resolves.toEqual({ published: false });
  });
});
