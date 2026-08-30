import type { PlatformPrisma } from "../infrastructure/prisma/index.js";
import { assembleMaterials } from "../modules/materials/index.js";

const actor = "72000000-0000-4000-8000-000000000001";
const topicId = "72000000-0000-4000-8000-000000000002";
const formatId = "72000000-0000-4000-8000-000000000003";
const createIdempotencyKey = "72000000-0000-4000-8000-000000000004";
const tagId = "72000000-0000-4000-8000-000000000006";
const seriesId = "72000000-0000-4000-8000-000000000007";
const slug = "kak-ustroen-inside-platform";
const membershipSlug = "developer-pipeline-bez-poteri-konteksta";
const membershipCreateIdempotencyKey = "72000000-0000-4000-8000-000000000033";

export interface LocalDevelopmentSeed {
  readonly materialId: string;
  readonly contentVersion: number;
  readonly slug: string;
}

export async function seedLocalDevelopment(
  prisma: PlatformPrisma,
): Promise<LocalDevelopmentSeed> {
  await ensureReferenceData(prisma);

  const { authoring } = assembleMaterials({
    prisma,
    authorPolicy: {
      canManage: (accountId) => accountId === actor,
    },
  });
  await ensureCatalogContinuationMaterials(prisma, authoring);
  const representativeMaterial = {
    metadata: {
      title: "Как устроен Inside Platform",
      summary: "Representative published Material для локальной full-stack разработки.",
      access: "free",
      topicId,
      formatId,
      tagIds: [tagId],
      seriesIds: [seriesId],
    },
    body: {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: {
              level: 2,
              nodeId: "72000000-0000-4000-8000-000000000010",
            },
            content: [{ type: "text", text: "Первый вертикальный срез" }],
          },
          {
            type: "paragraph",
            attrs: { nodeId: "72000000-0000-4000-8000-000000000011" },
            content: [
              {
                type: "text",
                text: "Этот материал создаётся идемпотентным local seed через application interface.",
              },
            ],
          },
          {
            type: "bulletList",
            attrs: { nodeId: "72000000-0000-4000-8000-000000000012" },
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { nodeId: "72000000-0000-4000-8000-000000000013" },
                    content: [{ type: "text", text: "PostgreSQL хранит current Material." }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { nodeId: "72000000-0000-4000-8000-000000000014" },
                    content: [{ type: "text", text: "Nest применяет access policy." }],
                  },
                ],
              },
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    attrs: { nodeId: "72000000-0000-4000-8000-000000000015" },
                    content: [{ type: "text", text: "Next server-renders Reader." }],
                  },
                ],
              },
            ],
          },
          {
            type: "callout",
            attrs: {
              kind: "note",
              nodeId: "72000000-0000-4000-8000-000000000016",
            },
            content: [
              {
                type: "paragraph",
                attrs: { nodeId: "72000000-0000-4000-8000-000000000017" },
                content: [
                  {
                    type: "text",
                    text: "Один production path остаётся authority для browser и tests.",
                  },
                ],
              },
            ],
          },
          {
            type: "heading",
            attrs: {
              level: 2,
              nodeId: "72000000-0000-4000-8000-000000000018",
            },
            content: [{ type: "text", text: "Проверяемый результат" }],
          },
          {
            type: "codeBlock",
            attrs: { nodeId: "72000000-0000-4000-8000-000000000019" },
            content: [{ type: "text", text: "pnpm smoke:fullstack" }],
          },
          {
            type: "table",
            attrs: { nodeId: "72000000-0000-4000-8000-000000000020" },
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [
                      {
                        type: "paragraph",
                        attrs: { nodeId: "72000000-0000-4000-8000-000000000021" },
                        content: [{ type: "text", text: "Seam" }],
                      },
                    ],
                  },
                  {
                    type: "tableHeader",
                    content: [
                      {
                        type: "paragraph",
                        attrs: { nodeId: "72000000-0000-4000-8000-000000000022" },
                        content: [{ type: "text", text: "Evidence" }],
                      },
                    ],
                  },
                ],
              },
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        attrs: { nodeId: "72000000-0000-4000-8000-000000000023" },
                        content: [{ type: "text", text: "Reader route" }],
                      },
                    ],
                  },
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        attrs: { nodeId: "72000000-0000-4000-8000-000000000024" },
                        content: [{ type: "text", text: "Meaningful initial HTML" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "assetImage",
            attrs: {
              nodeId: "72000000-0000-4000-8000-000000000025",
              assetId: "72000000-0000-4000-8000-000000000030",
              alt: "Путь Material от PostgreSQL до Reader",
              caption: "Один vertical production path",
            },
          },
          {
            type: "assetFile",
            attrs: {
              nodeId: "72000000-0000-4000-8000-000000000026",
              assetId: "72000000-0000-4000-8000-000000000031",
              label: "Reader verification checklist",
            },
          },
          {
            type: "video",
            attrs: {
              nodeId: "72000000-0000-4000-8000-000000000027",
              videoId: "72000000-0000-4000-8000-000000000032",
              caption: "Reader vertical slice walkthrough",
            },
          },
        ],
      },
    },
  } as const;
  const existing = await prisma.material.findUnique({
    where: { slug },
    select: { id: true },
  });
  let materialIdValue = existing?.id;
  if (materialIdValue === undefined) {
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: createIdempotencyKey,
      ...representativeMaterial,
    });
    if (!created.ok) {
      throw new Error(`Local Material draft failed: ${created.error.code}`);
    }
    materialIdValue = created.value.materialId;
  }
  const loaded = await authoring.loadMaterial({
    actor,
    materialId: materialIdValue,
  });
  if (!loaded.ok) {
    throw new Error(`Local Material load failed: ${loaded.error.code}`);
  }
  let contentVersion = loaded.value.contentVersion;
  if (
    loaded.value.publicationState !== "published" ||
    !loaded.value.metadata.tagIds.includes(tagId)
  ) {
    const saved = await authoring.saveMaterial({
      actor,
      idempotencyKey: `local-overview-save-${String(contentVersion)}`,
      materialId: materialIdValue,
      expectedContentVersion: contentVersion,
      publicationState: "published",
      ...representativeMaterial,
    });
    if (!saved.ok) {
      throw new Error(`Local Material Save failed: ${saved.error.code}`);
    }
    contentVersion = saved.value.contentVersion;
  }

  await ensureMembershipCatalogMaterial(prisma, authoring);
  await ensureRelatedPin(prisma, materialIdValue);

  return Object.freeze({ materialId: materialIdValue, contentVersion, slug });
}

async function ensureCatalogContinuationMaterials(
  prisma: PlatformPrisma,
  authoring: ReturnType<typeof assembleMaterials>["authoring"],
): Promise<void> {
  for (let index = 1; index <= 11; index += 1) {
    const sequence = String(index).padStart(2, "0");
    const nodeId = `73000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const metadata = {
        title: `Архитектурная заметка ${sequence}`,
        summary: "Дополнительный published Material для проверки infinite catalog.",
        access: "free" as const,
        topicId,
        formatId,
        tagIds: [],
        seriesIds: [],
      };
    const body = {
        schemaVersion: 1,
        doc: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { nodeId },
              content: [{ type: "text", text: `Материал ${sequence}.` }],
            },
          ],
        },
      } as const;
    const existing = await prisma.material.findUnique({
      where: { slug: `arkhitekturnaya-zametka-${sequence}` },
      select: { id: true, contentVersion: true, publicationState: true },
    });
    let material = existing;
    if (material === null) {
      const created = await authoring.createDraft({
        actor,
        idempotencyKey: `local-catalog-create-${sequence}`,
        metadata,
        body,
      });
      if (!created.ok) {
        throw new Error(`Local catalog draft failed: ${created.error.code}`);
      }
      material = {
        id: created.value.materialId,
        contentVersion: BigInt(created.value.contentVersion),
        publicationState: created.value.publicationState,
      };
    }
    if (material.publicationState !== "published") {
      const expectedContentVersion = Number(material.contentVersion);
      const published = await authoring.saveMaterial({
        actor,
        idempotencyKey: `local-catalog-publish-${sequence}-${String(expectedContentVersion)}`,
        materialId: material.id,
        expectedContentVersion,
        publicationState: "published",
        metadata,
        body,
      });
      if (!published.ok) {
        throw new Error(`Local catalog publish failed: ${published.error.code}`);
      }
    }
  }
}

async function ensureMembershipCatalogMaterial(
  prisma: PlatformPrisma,
  authoring: ReturnType<typeof assembleMaterials>["authoring"],
): Promise<void> {
  const metadata = {
      title: "Developer Pipeline без потери контекста",
      summary: "Закрытый Material с публичным безопасным описанием для каталога.",
      access: "membership" as const,
      topicId,
      formatId,
      tagIds: [tagId],
      seriesIds: [seriesId],
    };
  const body = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { nodeId: "72000000-0000-4000-8000-000000000035" },
            content: [{ type: "text", text: "Закрытое содержимое для участников." }],
          },
        ],
      },
    } as const;
  const existing = await prisma.material.findUnique({
    where: { slug: membershipSlug },
    select: { id: true, contentVersion: true, publicationState: true },
  });
  let material = existing;
  if (material === null) {
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: membershipCreateIdempotencyKey,
      metadata,
      body,
    });
    if (!created.ok) {
      throw new Error(`Local Membership Material draft failed: ${created.error.code}`);
    }
    material = {
      id: created.value.materialId,
      contentVersion: BigInt(created.value.contentVersion),
      publicationState: created.value.publicationState,
    };
  }
  const selectedSeries = await prisma.seriesMembership.findFirst({
    where: { materialId: material.id, seriesId },
    select: { materialId: true },
  });
  if (
    material.publicationState !== "published" ||
    selectedSeries === null
  ) {
    const expectedContentVersion = Number(material.contentVersion);
    const published = await authoring.saveMaterial({
      actor,
      idempotencyKey: `local-membership-publish-${String(expectedContentVersion)}`,
      materialId: material.id,
      expectedContentVersion,
      publicationState: "published",
      metadata,
      body,
    });
    if (!published.ok) {
      throw new Error(`Local Membership Material publish failed: ${published.error.code}`);
    }
  }
}

async function ensureRelatedPin(
  prisma: PlatformPrisma,
  sourceMaterialId: string,
): Promise<void> {
  const target = await prisma.material.findUnique({
    where: { slug: "arkhitekturnaya-zametka-01" },
    select: { id: true },
  });
  if (target === null) {
    throw new Error("Local related Material target is missing");
  }
  await prisma.materialRelatedPin.upsert({
    where: {
      sourceMaterialId_targetMaterialId: {
        sourceMaterialId,
        targetMaterialId: target.id,
      },
    },
    create: {
      sourceMaterialId,
      targetMaterialId: target.id,
      ordinal: 1,
    },
    update: { ordinal: 1 },
  });
}

async function ensureReferenceData(prisma: PlatformPrisma): Promise<void> {
  await prisma.topic.upsert({
    where: { id: topicId },
    create: { id: topicId, slug: "platform", name: "Platform" },
    update: {},
  });
  await prisma.format.upsert({
    where: { id: formatId },
    create: { id: formatId, slug: "guide", name: "Guide" },
    update: {},
  });
  await prisma.tag.upsert({
    where: { id: tagId },
    create: {
      id: tagId,
      name: "Full stack",
      normalizedName: "full stack",
    },
    update: {},
  });
  await prisma.series.upsert({
    where: { id: seriesId },
    create: {
      id: seriesId,
      slug: "platform-inside",
      name: "Создание Platform Inside",
    },
    update: {},
  });
}
