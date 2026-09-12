import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

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
  type MaterialMetadataDto,
  type MaterialMetadataSelectionInput,
} from "../../src/modules/materials/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import type { PlatformPrisma } from "../../src/infrastructure/prisma/index.js";

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

  /** Витрина отдаёт только включённое в продажу, поэтому это и есть каталог глазами покупателя. */
  async function forSale() {
    const result = await storefront.offers({ limit: 100 });
    if (!result.ok) throw new Error(result.error.code);
    return result.value.items;
  }

  async function seededOffer() {
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

  test("restores a seeded offer left without a payment option", async () => {
    const seeded = await seededOffer();
    // Прошлый запуск мог оборваться между созданием предложения и его варианта оплаты. Продавать
    // в таком каталоге нечего, и сам по себе он не выправится: предложение уже есть, поэтому
    // следующий запуск не может завести его заново.
    await testDatabase.prisma.billingPaymentOption.delete({
      where: { id: seeded.paymentOption.id },
    });
    expect((await forSale()).map((snapshot) => snapshot.offer.id)).not.toContain(
      seeded.offer.id,
    );

    await seedLocalDevelopment(testDatabase.prisma);

    const restored = (await forSale()).find(
      (snapshot) => snapshot.offer.id === seeded.offer.id,
    );
    expect(restored?.paymentOption.id).toBe(seeded.paymentOption.id);
    expect(restored?.firstPriceKopecks).toBe(seeded.firstPriceKopecks);
    await expect(testDatabase.prisma.billingPaymentOption.count()).resolves.toBe(3);
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

/**
 * Смена демо-контента на уже засеянной базе. Владелец забирает новый main и поднимает стенд
 * поверх существующего тома, поэтому засев обязан довести демо-материалы до текущего определения,
 * а не отказать и не оставить прежнюю копию.
 */
describe("local development seed after a demo content change", () => {
  const seedActor = "72000000-0000-4000-8000-000000000001";
  const stepTitle = "Demo · Подготовка приложения к релизу";
  let testDatabase: TestDatabase;

  // Бюджет останавливает зависший прогон, а не измеряет машину: создание базы, миграции и полный
  // засев не укладываются в десять секунд по умолчанию, когда на машине работает кто-то ещё.
  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await seedLocalDevelopment(testDatabase.prisma);
  }, 120_000);

  afterAll(async () => {
    await testDatabase.dispose();
  });

  function demoStep() {
    return testDatabase.prisma.material.findFirstOrThrow({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { body: true, difficulty: true, id: true, outcomes: true },
      where: { title: stepTitle },
    });
  }

  function blocks(document: unknown) {
    return z
      .object({ content: z.array(z.looseObject({ type: z.string() })) })
      .parse(document).content;
  }

  /** Определение материала в том виде, в каком его принимает Save: без slug и с плоскими сериями. */
  function definitionOf(
    metadata: MaterialMetadataDto,
  ): MaterialMetadataSelectionInput {
    return {
      access: metadata.access,
      difficulty: metadata.difficulty,
      formatId: metadata.formatId,
      outcomes: metadata.outcomes,
      seriesIds: metadata.seriesMemberships.map(({ seriesId }) => seriesId),
      summary: metadata.summary,
      tagIds: metadata.tagIds,
      title: metadata.title,
      topicId: metadata.topicId,
    };
  }

  /**
   * Клиент, считающий открытые транзакции. Команды авторского слоя выполняются в транзакции,
   * а чтения — нет, поэтому счётчик отличает отправленную команду от её отсутствия.
   */
  function countingTransactions(client: PlatformPrisma) {
    let opened = 0;
    const prisma = new Proxy(client, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property);
        if (typeof value !== "function") {
          return value;
        }
        return (...input: readonly unknown[]): unknown => {
          if (property === "$transaction") {
            opened += 1;
          }
          return Reflect.apply(value, target, input);
        };
      },
    });
    return { opened: () => opened, prisma };
  }

  /** Всё, что засев мог бы переписать: материалы, их видео и состав руководств. */
  async function writtenState() {
    return {
      guideMemberships: await testDatabase.prisma.guideMembership.findMany({
        orderBy: [{ seriesId: "asc" }, { materialId: "asc" }],
        select: { materialId: true, ordinal: true, seriesId: true, stepGroup: true },
      }),
      materials: await testDatabase.prisma.material.findMany({
        orderBy: { id: "asc" },
        select: { contentVersion: true, id: true, updatedAt: true },
      }),
      videos: await testDatabase.prisma.video.findMany({
        orderBy: { id: "asc" },
        select: { id: true, materialId: true, state: true, updatedAt: true },
      }),
    };
  }

  test("brings a step seeded before the change to the current definition", async () => {
    const seeded = await demoStep();
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === seedActor },
    });
    const loaded = await authoring.loadMaterial({
      actor: seedActor,
      materialId: seeded.id,
    });
    if (!loaded.ok) throw new Error(loaded.error.code);
    // Тот же шаг в том виде, в каком его оставило прежнее определение: без вариантного блока,
    // без сложности и без «Чему научишься».
    const earlier = await authoring.saveMaterial({
      actor: seedActor,
      body: {
        schemaVersion: 1,
        doc: {
          ...loaded.value.body.doc,
          content: blocks(loaded.value.body.doc).filter(
            ({ type }) => type !== "variant",
          ),
        },
      },
      expectedContentVersion: loaded.value.contentVersion,
      idempotencyKey: `earlier-demo-definition-${randomUUID()}`,
      materialId: seeded.id,
      metadata: { ...definitionOf(loaded.value.metadata), difficulty: null, outcomes: [] },
      publicationState: "published",
    });
    if (!earlier.ok) throw new Error(earlier.error.code);
    // Прежнее определение оставило свой отпечаток на постоянных ключах создания. Именно на нём
    // повторный засев падал с idempotency_key_reused и не давал подняться api и web. Отпечаток
    // портится у всех ключей создания, а не только у демо-серии: безусловное создание в любом
    // месте засева должно ронять эту проверку. Совпавших записей должно быть сколько-то —
    // иначе проверка прошла бы вхолостую, не проверив ничего.
    const armed = await testDatabase.prisma.authoringIdempotency.updateMany({
      data: { requestFingerprint: "0".repeat(64) },
      where: { operation: "create_draft" },
    });
    expect(armed.count).toBeGreaterThan(0);
    // Проверка опирается на чужое поведение: ключ создания с другим отпечатком отвергается, а не
    // воспроизводится. Оно проверяется здесь же, иначе эта проверка однажды пройдёт вхолостую,
    // ничего не доказав про засев.
    const poisoned = await testDatabase.prisma.authoringIdempotency.findFirstOrThrow({
      orderBy: { idempotencyKey: "asc" },
      select: { idempotencyKey: true },
      where: { operation: "create_draft" },
    });
    await expect(
      authoring.createDraft({
        actor: seedActor,
        body: {
          schemaVersion: 1,
          doc: {
            content: [
              {
                attrs: { nodeId: "70000000-0000-4000-8000-000000000002" },
                content: [{ type: "text", text: "Проверка занятого ключа." }],
                type: "paragraph",
              },
            ],
            type: "doc",
          },
        },
        idempotencyKey: poisoned.idempotencyKey,
        metadata: definitionOf(loaded.value.metadata),
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "idempotency_key_reused" } });

    await seedLocalDevelopment(testDatabase.prisma);

    const current = await demoStep();
    expect(blocks(current.body).map(({ type }) => type)).toContain("variant");
    expect(current.difficulty).toBe("basic");
    expect(current.outcomes).toEqual([
      "Собрать приложение под релиз",
      "Проверить сборку до публикации",
    ]);
    // Второго демо-материала не появилось: обновляется тот же шаг, а не его копия.
    await expect(
      testDatabase.prisma.material.count({ where: { title: stepTitle } }),
    ).resolves.toBe(1);
  });

  /**
   * Один отрицательный набор на все места засева. Он краснеет, как только любое из них перестаёт
   * сравнивать тело перед Save: изменённое определение тихо не доедет до уже засеянной базы, и
   * стенд покажет прежний контент, выглядя исправным.
   */
  test("returns every seeded Material to its body after the stored body is changed", async () => {
    const titles = [
      "Архитектурная заметка 01",
      "Границы хорошего модуля",
      "Как устроен Inside Platform",
      "Demo · Подготовка приложения к релизу",
      "Developer Pipeline без потери контекста",
    ];
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: (accountId) => accountId === seedActor },
    });
    const seededBodies = new Map<string, unknown>();
    for (const title of titles) {
      const material = await testDatabase.prisma.material.findFirstOrThrow({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { body: true, id: true },
        where: { title },
      });
      seededBodies.set(title, material.body);
      const loaded = await authoring.loadMaterial({
        actor: seedActor,
        materialId: material.id,
      });
      if (!loaded.ok) throw new Error(`${title}: ${loaded.error.code}`);
      const changed = await authoring.saveMaterial({
        actor: seedActor,
        body: {
          schemaVersion: 1,
          doc: {
            content: [
              {
                attrs: { nodeId: "70000000-0000-4000-8000-000000000001" },
                content: [{ type: "text", text: "Тело изменено мимо засева." }],
                type: "paragraph",
              },
            ],
            type: "doc",
          },
        },
        expectedContentVersion: loaded.value.contentVersion,
        idempotencyKey: `changed-body-${randomUUID()}`,
        materialId: material.id,
        metadata: definitionOf(loaded.value.metadata),
        primaryVideoId: loaded.value.primaryVideoId,
        publicationState: "published",
      });
      if (!changed.ok) throw new Error(`${title}: ${changed.error.code}`);
    }

    await seedLocalDevelopment(testDatabase.prisma);

    // Сравниваются все места сразу, чтобы падение называло каждое отставшее, а не только первое.
    const restored = [];
    for (const title of titles) {
      const material = await testDatabase.prisma.material.findFirstOrThrow({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { body: true },
        where: { title },
      });
      restored.push({ body: material.body, title });
    }
    expect(restored).toEqual(
      titles.map((title) => ({ body: seededBodies.get(title), title })),
    );
  });

  test("sends no change command when the definition already matches", async () => {
    await seedLocalDevelopment(testDatabase.prisma);
    const written = await writtenState();
    const receipts = await testDatabase.prisma.authoringIdempotency.count();

    // Каждая команда авторского слоя — создание, Save, переупорядочивание — открывает свою
    // транзакцию, в том числе та, что потом коротко замыкается и ничего не пишет. Поэтому
    // прогон, не открывший ни одной, не отправил ни одной команды: это проверяет обещание
    // runbook целиком, а не только отсутствие записи.
    const counted = countingTransactions(testDatabase.prisma);
    await seedLocalDevelopment(counted.prisma);

    expect(counted.opened()).toBe(0);
    await expect(writtenState()).resolves.toEqual(written);
    await expect(
      testDatabase.prisma.authoringIdempotency.count(),
    ).resolves.toBe(receipts);
  });
});
