import type { PlatformPrisma } from "../infrastructure/prisma/index.js";
import { assembleMaterials } from "../modules/materials/index.js";

const actor = "72000000-0000-4000-8000-000000000001";
const topicId = "72000000-0000-4000-8000-000000000002";
const formatId = "72000000-0000-4000-8000-000000000003";
const createIdempotencyKey = "72000000-0000-4000-8000-000000000004";
const publishIdempotencyKey = "72000000-0000-4000-8000-000000000005";
const tagId = "72000000-0000-4000-8000-000000000006";
const seriesId = "72000000-0000-4000-8000-000000000007";
const reviseIdempotencyKey = "72000000-0000-4000-8000-000000000008";
const republishIdempotencyKey = "72000000-0000-4000-8000-000000000009";
const slug = "inside-platform-overview";
const membershipSlug = "membership-delivery-guide";
const membershipCreateIdempotencyKey = "72000000-0000-4000-8000-000000000033";
const membershipPublishIdempotencyKey = "72000000-0000-4000-8000-000000000034";

export interface LocalDevelopmentSeed {
  readonly materialId: string;
  readonly revisionId: string;
  readonly slug: string;
}

export async function seedLocalDevelopment(
  prisma: PlatformPrisma,
): Promise<LocalDevelopmentSeed> {
  await ensureReferenceData(prisma);

  const { authoring } = assembleMaterials({
    prisma,
    authorPolicy: {
      canAuthor: (principalId) => principalId === actor,
      canPublish: ({ principalId }) => principalId === actor,
    },
  });
  await ensureCatalogContinuationMaterials(authoring);
  const representativeRevision = {
    metadata: {
      title: "Как устроен Inside Platform",
      summary: "Representative published Material для локальной full-stack разработки.",
      slug,
      access: "free",
      topicId,
      formatId,
      tagIds: [tagId],
      seriesMemberships: [{ seriesId, ordinal: 1 }],
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
                    content: [{ type: "text", text: "PostgreSQL хранит exact revision." }],
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
  // Keep the original command stable so pre-Reader development volumes can
  // replay it through the application idempotency contract.
  const created = await authoring.createDraft({
    actor,
    idempotencyKey: createIdempotencyKey,
    metadata: {
      ...representativeRevision.metadata,
      tagIds: [],
      seriesMemberships: [],
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
        ],
      },
    },
  });
  if (!created.ok) {
    throw new Error(`Local Material draft failed: ${created.error.code}`);
  }

  const initialPublication = await authoring.publishRevision({
    actor,
    idempotencyKey: publishIdempotencyKey,
    materialId: created.value.materialId,
    revisionId: created.value.revisionId,
    expectedPublishedRevisionId: null,
  });
  if (!initialPublication.ok) {
    throw new Error(`Local Material publish failed: ${initialPublication.error.code}`);
  }

  const loaded = await authoring.loadDraft({
    actor,
    materialId: created.value.materialId,
  });
  if (!loaded.ok) {
    throw new Error(`Local Material draft failed: ${loaded.error.code}`);
  }
  let currentDraft = loaded.value;

  if (!currentDraft.metadata.tagIds.includes(tagId)) {
    const revised = await authoring.reviseDraft({
      actor,
      idempotencyKey: reviseIdempotencyKey,
      materialId: currentDraft.materialId,
      baseRevisionId: currentDraft.revisionId,
      changes: {
        metadata: {
          tagIds: [tagId],
          seriesMemberships: [{ seriesId, ordinal: 1 }],
        },
        body: [
          {
            kind: "replace_document",
            document: representativeRevision.body,
          },
        ],
      },
    });
    if (!revised.ok) {
      throw new Error(`Local Material revision failed: ${revised.error.code}`);
    }
    currentDraft = revised.value;
  }

  const validated = await authoring.validateRevision({
    actor,
    materialId: currentDraft.materialId,
    revisionId: currentDraft.revisionId,
  });
  if (!validated.ok) {
    throw new Error(`Local Material validation failed: ${validated.error.code}`);
  }

  const published = await authoring.publishRevision({
    actor,
    idempotencyKey: republishIdempotencyKey,
    materialId: currentDraft.materialId,
    revisionId: currentDraft.revisionId,
    expectedPublishedRevisionId: created.value.revisionId,
  });
  if (!published.ok) {
    throw new Error(`Local Material publish failed: ${published.error.code}`);
  }

  await ensureMembershipCatalogMaterial(authoring);

  return Object.freeze({
    materialId: currentDraft.materialId,
    revisionId: currentDraft.revisionId,
    slug,
  });
}

async function ensureCatalogContinuationMaterials(
  authoring: ReturnType<typeof assembleMaterials>["authoring"],
): Promise<void> {
  for (let index = 1; index <= 11; index += 1) {
    const sequence = String(index).padStart(2, "0");
    const nodeId = `73000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: `local-catalog-create-${sequence}`,
      metadata: {
        title: `Архитектурная заметка ${sequence}`,
        summary: "Дополнительный published Material для проверки infinite catalog.",
        slug: `architecture-note-${sequence}`,
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: {
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
      },
    });
    if (!created.ok) {
      throw new Error(`Local catalog draft failed: ${created.error.code}`);
    }
    const published = await authoring.publishRevision({
      actor,
      idempotencyKey: `local-catalog-publish-${sequence}`,
      materialId: created.value.materialId,
      revisionId: created.value.revisionId,
      expectedPublishedRevisionId: null,
    });
    if (!published.ok) {
      throw new Error(`Local catalog publish failed: ${published.error.code}`);
    }
  }
}

async function ensureMembershipCatalogMaterial(
  authoring: ReturnType<typeof assembleMaterials>["authoring"],
): Promise<void> {
  const created = await authoring.createDraft({
    actor,
    idempotencyKey: membershipCreateIdempotencyKey,
    metadata: {
      title: "Developer Pipeline без потери контекста",
      summary: "Закрытый Material с публичным безопасным описанием для каталога.",
      slug: membershipSlug,
      access: "membership",
      topicId,
      formatId,
      tagIds: [tagId],
      seriesMemberships: [],
    },
    body: {
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
    },
  });
  if (!created.ok) {
    throw new Error(`Local Membership Material draft failed: ${created.error.code}`);
  }
  const published = await authoring.publishRevision({
    actor,
    idempotencyKey: membershipPublishIdempotencyKey,
    materialId: created.value.materialId,
    revisionId: created.value.revisionId,
    expectedPublishedRevisionId: null,
  });
  if (!published.ok) {
    throw new Error(`Local Membership Material publish failed: ${published.error.code}`);
  }
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
