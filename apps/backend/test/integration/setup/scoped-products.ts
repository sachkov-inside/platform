import { assembleApplySourceTask } from "../../../src/modules/product-tasks/features/import-product-task/import-product-task.js";
import { ProductDirectory } from "../../../src/modules/products/index.js";
import { assembleProductMaterialReading } from "../../../src/modules/materials/index.js";
import { fixedTestInstant } from "../../support/fixed-clock.js";
import { grantProductFixture, revokeProductFixture } from "./product-access.js";
import { randomUUID } from "node:crypto";

import { assembleMaterials } from "../../../src/entrypoints/composition/assemble-materials.js";
import type { TestDatabase } from "./test-database.js";

/**
 * Мир для проверок scoped ученика через настоящий транспорт: два Product с закрытым материалом,
 * файлом, видео и заданием и один публичный материал. Ученик получает lifetime Product Access через владельческий facade, без legacy bridge и `wholePlatform`.
 * Секрет каждого Product содержит
 * уникальный текст в теле и требованиях задания: транспорт доказывает доступ наличием этих bytes,
 * а отказ — их отсутствием.
 */
export interface ScopedProduct {
  readonly productId: string;
  readonly slug: string;
  readonly materialId: string;
  readonly contentVersion: number;
  readonly assetId: string;
  readonly protectedObjectKey: string;
  readonly videoId: string;
  readonly providerVideoId: string;
  readonly taskCode: string;
  /** Текст, который есть только в закрытом теле. */
  readonly bodySecret: string;
  /** Секрет требований, защищённый у закрытого Task. */
  readonly taskSecret: string;
}

export interface PublicMaterial {
  readonly slug: string;
  readonly bodyText: string;
}

export interface ScopedProductsWorld {
  readonly productA: ScopedProduct;
  readonly productB: ScopedProduct;
  /** Product с бесплатным уроком и опубликованным заданием: его читает любой Account (#938). */
  readonly freeProduct: ScopedProduct;
  readonly publicMaterial: PublicMaterial;
  /** Бессрочное право на один Product; возвращает ссылку для отзыва. */
  grantProduct(accountId: string, productId: string): Promise<string>;
  /** Passive historical grant that expired before the current clock instant. */
  grantExpiredProduct(accountId: string, productId: string): Promise<void>;
  revokeGrant(grantRef: string): Promise<void>;
}

const ownerSubject = "scoped-products-owner";

export async function createScopedProductsWorld(
  database: TestDatabase,
): Promise<ScopedProductsWorld> {
  const owner = randomUUID();
  await database.prisma.account.create({
    data: {
      id: owner,
      logtoIssuer: "https://identity.scoped.test",
      logtoSubject: ownerSubject,
    },
  });
  await database.prisma.accountPermission.create({
    data: { accountId: owner, permission: "platform:admin" },
  });
  // deterministic-test-allow wall-clock: Callers registerFixedClock; fixture and in-process consumers share virtual Date.

  const materials = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: { canManage: (id) => id === owner },
  });
  const topicId = randomUUID();
  await database.prisma.topic.create({
    data: { id: topicId, slug: `scoped-${topicId}`, name: "Scoped access" },
  });

  async function sourceMaterial(input: {
    readonly key: string;
    readonly access: "free" | "closed";
    readonly productIds: readonly string[];
    readonly body: (materialId: string) => Promise<Record<string, unknown>>;
  }) {
    const source = {
      id: `scoped:${input.key}`,
      path: `lessons/${input.key}.md`,
      revision: "a".repeat(64),
      version: 2 as const,
    };
    const reserved = await materials.authoring.reserveSourceMaterial({
      actor: owner,
      source,
    });
    if (!reserved.ok) throw new Error(reserved.error.code);
    const doc = await input.body(reserved.value.materialId);
    const applied = await materials.authoring.applySourceMaterial({
      actor: owner,
      idempotencyKey: `scoped-${input.key}`,
      source,
      materialId: reserved.value.materialId,
      expectedContentVersion: reserved.value.contentVersion,
      publicationState: "published",
      primaryVideoId: null,
      metadata: {
        title: `Scoped ${input.key}`,
        summary: "Публичное описание scoped материала",
        access: input.access,
        topicId,
        formatId: "guide",
        tagIds: [],
        productIds: [...input.productIds],
        difficulty: null,
        outcomes: [],
      },
      body: { schemaVersion: 1, doc },
    });
    if (!applied.ok) throw new Error(applied.error.code);
    const loaded = await database.prisma.material.findUniqueOrThrow({
      where: { id: applied.value.materialId },
    });
    if (loaded.slug === null) throw new Error("Published Material has no slug");
    return {
      materialId: applied.value.materialId,
      contentVersion: applied.value.contentVersion,
      slug: loaded.slug,
      source,
    };
  }

  async function scopedProduct(
    label: string,
    access: "free" | "closed" = "closed",
  ): Promise<ScopedProduct> {
    const productId = randomUUID();
    await database.prisma.product.create({
      // Материал из источника входит только в Product из источника.
      data: {
        id: productId,
        slug: `scoped-product-${productId}`,
        name: label,
        sourceId: `scoped:product-${productId}`,
      },
    });
    const bodySecret = `CLOSED-BODY-${label}-${randomUUID()}`;
    const taskSecret = `CLOSED-TASK-${label}-${randomUUID()}`;
    const assetId = randomUUID(),
      videoId = randomUUID(),
      providerVideoId = randomUUID();
    let protectedObjectKey = "";
    const created = await sourceMaterial({
      key: `product-${label.toLowerCase()}-${productId}`,
      access,
      productIds: [productId],
      body: async (materialId) => {
        protectedObjectKey = `materials/${materialId}/assets/${assetId}/original`;
        // deterministic-test-allow wall-clock: Callers registerFixedClock; fixture and in-process consumers share virtual Date.
        const ready = new Date();
        await database.prisma.materialAsset.create({
          data: {
            id: assetId,
            materialId,
            uploadedBy: owner,
            kind: "file",
            state: "ready",
            idempotencyKey: `scoped-${assetId}`,
            requestFingerprint: "0".repeat(64),
            originalFilename: `product-${label}.txt`,
            declaredContentType: "text/plain",
            declaredSize: 4,
            expectedChecksum: "0".repeat(64),
            actualContentType: "text/plain",
            actualSize: 4,
            actualChecksum: "0".repeat(64),
            objectNonce: randomUUID(),
            quarantineObjectKey: `materials/${materialId}/assets/${assetId}/quarantine`,
            protectedObjectKey,
            readyAt: ready,
            orphanedAt: ready,
          },
        });
        await database.prisma.video.create({
          data: {
            id: videoId,
            materialId,
            createdBy: owner,
            access: "closed",
            projectId: "members",
            providerVideoId,
            title: `Видео ${label}`,
            origin: "platform_upload",
            providerStatus: "done",
            state: "ready",
            readyAt: ready,
            providerVisibleAt: ready,
            providerEmbedLocator: `https://kinescope.io/embed/${providerVideoId}`,
            durationSeconds: 60,
          },
        });
        return {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: randomUUID() },
              content: [{ type: "text", text: bodySecret }],
            },
            {
              type: "assetFile",
              attrs: { nodeId: randomUUID(), assetId, label: `Файл ${label}` },
            },
            {
              // Длинный урок: контекст задания для learner MCP делится на несколько частей.
              type: "paragraph",
              attrs: { nodeId: randomUUID() },
              content: [
                { type: "text", text: "Закрытый урок. ".repeat(1_500) },
              ],
            },
          ],
        };
      },
    });
    // Facade authoring в тесте собран без Videos; основное видео ставится так же, как в
    // `product-access.test.ts`, после публикации и без новой версии тела.
    await database.prisma.material.update({
      where: { id: created.materialId },
      data: { primaryVideoId: videoId },
    });
    const chapterId = randomUUID();
    await database.prisma.productChapter.create({
      data: { id: chapterId, productId, name: `Chapter ${label}`, ordinal: 1 },
    });
    await database.prisma.productProgrammePlacement.create({
      data: {
        id: randomUUID(),
        productId,
        materialId: created.materialId,
        chapterId,
        ordinal: 1,
      },
    });
    const taskCode = `scoped-task-${label.toLowerCase()}-${productId}`;
    const applyTask = assembleApplySourceTask({
      prisma: database.prisma,
      directory: new ProductDirectory(
        database.prisma,
        assembleProductMaterialReading(database.prisma),
      ),
      authorPolicy: { canManage: (id) => id === owner },
    });
    const imported = await applyTask(
      {
        sourceId: `scoped:${taskCode}`,
        code: taskCode,
        productId,
        chapterId,
        position: 1,
        title: `Task ${label}`,
        access,
        expectedRevision: null,
        publicationState: "published",
        programmeVisibility: "embedded",
        embeddedMaterialSourceId: created.source.id,
        relatedMaterialSourceIds: [],
        definition: {
          schemaVersion: 1,
          situation: `Закрытые вводные ${taskSecret}`,
          result: ["Объяснить требования."],
          freedom: "Любой формат.",
          criteria: [
            {
              id: "scope",
              level: "required",
              requirement: "Ученик видит только свой Product.",
              acceptableEvidence: ["Требование с причиной."],
            },
          ],
        },
        provenance: {
          repository: "synthetic/scoped",
          commit: "b".repeat(40),
          path: `tasks/${productId}.json`,
        },
      },
      { actor: owner, idempotencyKey: `scoped-task-${productId}` },
    );
    if (!imported.ok) throw new Error(imported.error.code);
    return {
      productId,
      slug: created.slug,
      materialId: created.materialId,
      contentVersion: created.contentVersion,
      assetId,
      protectedObjectKey,
      videoId,
      providerVideoId,
      taskCode,
      bodySecret,
      taskSecret,
    };
  }

  const productA = await scopedProduct("A");
  const productB = await scopedProduct("B");
  const freeProduct = await scopedProduct("FREE", "free");
  const bodyText = `PUBLIC-BODY-${randomUUID()}`;
  const publicCreated = await sourceMaterial({
    key: `public-${randomUUID()}`,
    access: "free",
    productIds: [],
    body: () =>
      Promise.resolve({
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId: randomUUID() },
            content: [{ type: "text", text: bodyText }],
          },
        ],
      }),
  });

  return {
    productA,
    productB,
    freeProduct,
    publicMaterial: { slug: publicCreated.slug, bodyText },
    grantProduct: (accountId, productId) =>
      grantProductFixture(database.prisma, accountId, productId),
    async grantExpiredProduct(accountId, productId) {
      await database.prisma.accessGrant.create({
        data: {
          id: randomUUID(),
          accountId,
          source: "manual",
          sourceRef: randomUUID(),
          capabilities: [`product:${productId}`],
          startsAt: new Date(fixedTestInstant() - 2 * 86_400_000),
          validUntil: new Date(fixedTestInstant() - 86_400_000),
          revision: 1,
          reason:
            "Historical expired Product grant, without current Product Access",
        },
      });
    },
    async revokeGrant(target) {
      await revokeProductFixture(database.prisma, target);
    },
  };
}
