import { randomUUID } from "node:crypto";

import { assembleAccounts } from "../../../src/modules/accounts/index.js";
import {
  assembleAccessGrants,
  type AccessCapability,
} from "../../../src/modules/membership-entitlements/index.js";
import { assembleMaterials } from "../../../src/modules/materials/index.js";
import type { TestDatabase } from "./test-database.js";

/**
 * Мир для проверок scoped ученика через настоящий транспорт: два Guide с закрытым материалом,
 * файлом, видео и заданием и один публичный материал. Право ученика — настоящий AccessGrant
 * `guide:<id>` через владельческий facade, без legacy bridge и `allGuides`. Секрет каждого Guide —
 * уникальный текст в теле и в названии задания: транспорт доказывает доступ наличием этих bytes,
 * а отказ — их отсутствием.
 */
export interface ScopedGuide {
  readonly guideId: string;
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

export interface ScopedGuidesWorld {
  readonly guideA: ScopedGuide;
  readonly guideB: ScopedGuide;
  /** Guide с бесплатным уроком и опубликованным заданием: его читает любой Account (#938). */
  readonly freeGuide: ScopedGuide;
  readonly publicMaterial: PublicMaterial;
  /** Бессрочное право на один Guide; возвращает ссылку для отзыва. */
  grantGuide(accountId: string, guideId: string): Promise<string>;
  /** Право на один Guide, которое уже истекло. */
  grantExpiredGuide(accountId: string, guideId: string): Promise<void>;
  revokeGrant(grantRef: string): Promise<void>;
}

const ownerSubject = "scoped-guides-owner";

export async function createScopedGuidesWorld(
  database: TestDatabase,
): Promise<ScopedGuidesWorld> {
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
      emailFingerprintKey: "scoped-guides-email-fingerprint-key",
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
    readonly access: "free" | "membership";
    readonly guideIds: readonly string[];
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
        seriesIds: [...input.guideIds],
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

  async function scopedGuide(
    label: string,
    access: "free" | "membership" = "membership",
  ): Promise<ScopedGuide> {
    const guideId = randomUUID();
    await database.prisma.guide.create({
      // Материал из источника входит только в Guide из источника.
      data: {
        id: guideId,
        slug: `scoped-guide-${guideId}`,
        name: label,
        sourceId: `scoped:guide-${guideId}`,
      },
    });
    const bodySecret = `CLOSED-BODY-${label}-${randomUUID()}`;
    const practiceSecret = `CLOSED-PRACTICE-${label}-${randomUUID()}`;
    const assetId = randomUUID(),
      videoId = randomUUID(),
      providerVideoId = randomUUID();
    let protectedObjectKey = "";
    const created = await sourceMaterial({
      key: `guide-${label}-${guideId}`,
      access,
      guideIds: [guideId],
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
            originalFilename: `guide-${label}.txt`,
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
            access: "membership",
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
    // `guide-access.test.ts`, после публикации и без новой версии тела.
    await database.prisma.material.update({
      where: { id: created.materialId },
      data: { primaryVideoId: videoId },
    });
    const practiceId = `scoped:practice-${label.toLowerCase()}-${guideId}`;
    const practice = await materials.authoring.applySourcePractice({
      actor: owner,
      idempotencyKey: `scoped-practice-${guideId}`,
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
            requirement: "Ученик видит только свой Guide.",
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
        path: `practices/${guideId}.json`,
      },
    });
    if (!practice.ok) throw new Error(practice.error.code);
    return {
      guideId,
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

  const guideA = await scopedGuide("A");
  const guideB = await scopedGuide("B");
  const freeGuide = await scopedGuide("FREE", "free");
  const bodyText = `PUBLIC-BODY-${randomUUID()}`;
  const publicCreated = await sourceMaterial({
    key: `public-${randomUUID()}`,
    access: "free",
    guideIds: [],
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
    guideId: string,
    validUntil: string | null,
    startsAt: string,
  ): Promise<string> {
    const capability: AccessCapability = `guide:${guideId}`;
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
    guideA,
    guideB,
    freeGuide,
    publicMaterial: { slug: publicCreated.slug, bodyText },
    grantGuide: (accountId, guideId) =>
      grant(accountId, guideId, null, new Date().toISOString()),
    async grantExpiredGuide(accountId, guideId) {
      // Право выдано в прошлом и кончилось вчера: facade видит момент выдачи, транспорт — сегодня.
      const issued = Date.now() - 2 * 24 * 60 * 60 * 1_000;
      now = () => new Date(issued);
      try {
        await grant(
          accountId,
          guideId,
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
