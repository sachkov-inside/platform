import { randomUUID } from "node:crypto";

import { assembleAccounts } from "../../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  type AccessCapability,
} from "../../../src/modules/account-rights/index.js";
import { assembleMaterials } from "../../../src/modules/materials/index.js";
import type { TestDatabase } from "./test-database.js";

/**
 * Мир для проверок scoped ученика через настоящий транспорт: два Product с закрытым материалом,
 * файлом, видео и заданием и один публичный материал. Право ученика — настоящий AccessGrant
 * `product:<id>` через владельческий facade, без legacy bridge и `wholePlatform`. Секрет каждого Product —
 * уникальный текст в теле и в названии задания: транспорт доказывает доступ наличием этих bytes,
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
  readonly practiceId: string;
  /** Текст, который есть только в закрытом теле. */
  readonly bodySecret: string;
  /** Название задания: его отдают список заданий и контекст задания только Account с правом. */
  readonly practiceSecret: string;
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
  /** Право на один Product, которое уже истекло. */
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
  let now = (): Date => new Date();
  const grants = assembleAccessGrants({
    prisma: database.prisma,
    accounts: assembleAccounts({
      prisma: database.prisma,
      emailFingerprintKey: "scoped-products-email-fingerprint-key",
    }),
    clock: () => now(),
  });
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
      showInFeed: false,
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
        seriesIds: [...input.productIds],
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
    const practiceSecret = `CLOSED-PRACTICE-${label}-${randomUUID()}`;
    const assetId = randomUUID(),
      videoId = randomUUID(),
      providerVideoId = randomUUID();
    let protectedObjectKey = "";
    const created = await sourceMaterial({
      key: `product-${label}-${productId}`,
      access,
      productIds: [productId],
      body: async (materialId) => {
        protectedObjectKey = `materials/${materialId}/assets/${assetId}/original`;
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
    const practiceId = `scoped:practice-${label.toLowerCase()}-${productId}`;
    const practice = await materials.authoring.applySourcePractice({
      actor: owner,
      idempotencyKey: `scoped-practice-${productId}`,
      practiceId,
      materialId: created.materialId,
      expectedContentVersion: created.contentVersion,
      expectedPracticeVersion: null,
      publicationState: "published",
      definition: {
        schemaVersion: 1,
        title: practiceSecret,
        businessInputs: `Закрытые вводные ${practiceSecret}`,
        expectedOutcome: "Объяснить требования.",
        allowedFreedom: "Любой формат.",
        criteria: [
          {
            id: "scope",
            requirement: "Ученик видит только свой Product.",
            acceptableEvidence: ["Требование с причиной."],
          },
        ],
      },
      sourceReference: {
        materialSourceId: created.source.id,
        materialSourceRevision: created.source.revision,
      },
      provenance: {
        repository: "synthetic/scoped",
        commit: "b".repeat(40),
        path: `practices/${productId}.json`,
      },
    });
    if (!practice.ok) throw new Error(practice.error.code);
    return {
      productId,
      slug: created.slug,
      materialId: created.materialId,
      contentVersion: created.contentVersion,
      assetId,
      protectedObjectKey,
      videoId,
      providerVideoId,
      practiceId,
      bodySecret,
      practiceSecret,
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

  async function grant(
    accountId: string,
    productId: string,
    validUntil: string | null,
    startsAt: string,
  ): Promise<string> {
    const capability: AccessCapability = `product:${productId}`;
    const preview = await grants.previewBatch(owner, {
      operationId: randomUUID(),
      rows: [
        {
          rowKey: "scoped",
          accountId,
          source: "manual",
          sourceRef: randomUUID(),
          terms: {
            capabilities: [capability],
            startsAt,
            validUntil,
            reason: "Scoped learner fixture (#903)",
          },
        },
      ],
    });
    if (!preview.ok) throw new Error(preview.error.code);
    const applied = await grants.applyBatch(owner, {
      operationId: randomUUID(),
      previewRef: preview.previewRef,
      expectedRevision: preview.revision,
      confirmedRows: ["scoped"],
    });
    const row = applied.ok ? applied.rows[0]?.result : undefined;
    if (row === undefined || !row.ok || !("grantRef" in row))
      throw new Error("Scoped grant fixture failed");
    return row.grantRef;
  }

  return {
    productA,
    productB,
    freeProduct,
    publicMaterial: { slug: publicCreated.slug, bodyText },
    grantProduct: (accountId, productId) =>
      grant(accountId, productId, null, new Date().toISOString()),
    async grantExpiredProduct(accountId, productId) {
      // Право выдано в прошлом и кончилось вчера: facade видит момент выдачи, транспорт — сегодня.
      const issued = Date.now() - 2 * 24 * 60 * 60 * 1_000;
      now = () => new Date(issued);
      try {
        await grant(
          accountId,
          productId,
          new Date(issued + 24 * 60 * 60 * 1_000).toISOString(),
          new Date(issued).toISOString(),
        );
      } finally {
        now = () => new Date();
      }
    },
    async revokeGrant(grantRef) {
      const revoked = await grants.changeGrant(owner, {
        action: "revoke",
        operationId: randomUUID(),
        grantRef,
        expectedRevision: 1,
        reason: "Scoped learner revocation (#903)",
      });
      if (!revoked.ok) throw new Error(revoked.error.code);
    },
  };
}
