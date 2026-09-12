import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import {
  discoverPublishedMaterials,
  listPublishedMaterials,
} from "../../src/modules/content-library/index.js";
import { anonymousSubject } from "../../src/modules/content-access/index.js";
import { BillingPricing } from "../../src/modules/billing/index.js";
import type { PriceSnapshot } from "../../src/modules/billing/domain/pricing.js";
import { emptyCatalogVideos } from "../support/catalog-videos.js";
import {
  assembleMaterials,
} from "../../src/modules/materials/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

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
});

/**
 * Каталог стенда. Каждый сценарий сам возвращает каталог в засеянное состояние, поэтому порядок
 * тестов не решает их исход, а миграции одной базы не повторяются на каждый тест.
 */
describe("local development offer catalog", () => {
  const ownerActor = "72000000-0000-4000-8000-000000000590";
  let testDatabase: TestDatabase;
  let guideId: string;
  let owner: BillingPricing;
  let storefront: BillingPricing;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await seedLocalDevelopment(testDatabase.prisma);
    const guide = await testDatabase.prisma.guide.findUniqueOrThrow({
      select: { id: true },
      where: { slug: "platform-inside" },
    });
    guideId = guide.id;
    owner = new BillingPricing({
      prisma: testDatabase.prisma,
      accounts: {
        checkPermission: () => Promise.resolve({ ok: true, allowed: true }),
      },
    });
    storefront = new BillingPricing({
      prisma: testDatabase.prisma,
      accounts: {
        checkPermission: () => Promise.resolve({ ok: true, allowed: false }),
      },
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  async function forSale(): Promise<readonly PriceSnapshot[]> {
    const result = await storefront.offers({ limit: 100 });
    if (!result.ok) throw new Error(result.error.code);
    return result.value.items;
  }

  async function seededOffer(): Promise<PriceSnapshot> {
    const [first] = await forSale();
    if (first === undefined) throw new Error("Expected a seeded offer for sale");
    return first;
  }

  test("puts two subscriptions and one guide purchase on sale without a second set", async () => {
    await seedLocalDevelopment(testDatabase.prisma);

    expect(
      (await forSale()).map((snapshot) => ({
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
        benefits: [`guide:${guideId}`],
        firstPriceKopecks: 3_000,
        mode: "one_time",
        name: "Руководство «Создание Platform Inside»",
        published: true,
      },
    ]);
    // Повторный seed сходится к тому же описанию, поэтому второго набора не появляется.
    await expect(testDatabase.prisma.billingOffer.count()).resolves.toBe(3);
    await expect(testDatabase.prisma.billingPaymentOption.count()).resolves.toBe(3);
  });

  test("leaves an offer the owner took off sale off the storefront", async () => {
    const seeded = await seededOffer();
    const unpublished = await owner.manage(ownerActor, {
      expectedRevision: seeded.offer.revision,
      id: seeded.offer.id,
      operation: "offers.unpublish",
      operationId: randomUUID(),
    });
    if (!unpublished.ok) throw new Error(unpublished.error.code);
    try {
      await seedLocalDevelopment(testDatabase.prisma);

      expect((await forSale()).map((snapshot) => snapshot.offer.id)).not.toContain(
        seeded.offer.id,
      );
    } finally {
      await owner.manage(ownerActor, {
        expectedRevision: unpublished.value.revision,
        id: seeded.offer.id,
        operation: "offers.publish",
        operationId: randomUUID(),
      });
    }
  });

  test("brings a changed price back to the seeded catalog on the next run", async () => {
    const seeded = await seededOffer();
    const repriced = await owner.manage(ownerActor, {
      expectedRevision: seeded.paymentOption.revision,
      operation: "paymentOptions.save",
      operationId: randomUUID(),
      value: {
        id: seeded.paymentOption.id,
        mode: seeded.paymentOption.mode,
        months: seeded.paymentOption.months,
        offerId: seeded.offer.id,
        priceKopecks: 777_000,
      },
    });
    expect(repriced.ok).toBe(true);

    // Описание стенда — источник его цен, поэтому следующий запуск возвращает свою цену вместо
    // того, чтобы упасть на изменившемся снимке команды и не дать локальному стеку подняться.
    await seedLocalDevelopment(testDatabase.prisma);

    const restored = (await forSale()).find(
      (snapshot) => snapshot.paymentOption.id === seeded.paymentOption.id,
    );
    expect(restored?.firstPriceKopecks).toBe(seeded.firstPriceKopecks);
    await expect(testDatabase.prisma.billingPaymentOption.count()).resolves.toBe(3);
  });
});
