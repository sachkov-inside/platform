import type { PlatformDatabase } from "../infrastructure/postgres/index.js";
import { createMaterials } from "../modules/materials/index.js";

const actor = "72000000-0000-4000-8000-000000000001";
const topicId = "72000000-0000-4000-8000-000000000002";
const formatId = "72000000-0000-4000-8000-000000000003";
const createIdempotencyKey = "72000000-0000-4000-8000-000000000004";
const publishIdempotencyKey = "72000000-0000-4000-8000-000000000005";
const slug = "inside-platform-overview";

export interface LocalDevelopmentSeed {
  readonly materialId: string;
  readonly revisionId: string;
  readonly slug: string;
}

export async function seedLocalDevelopment(
  database: PlatformDatabase,
): Promise<LocalDevelopmentSeed> {
  await ensureReferenceData(database);

  const { authoring } = createMaterials({
    database,
    authorPolicy: {
      canAuthor: (principalId) => principalId === actor,
      canPublish: ({ principalId }) => principalId === actor,
    },
  });
  const created = await authoring.createDraft({
    actor,
    idempotencyKey: createIdempotencyKey,
    metadata: {
      title: "Как устроен Inside Platform",
      summary: "Representative published Material для локальной full-stack разработки.",
      slug,
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

  const validated = await authoring.validateRevision({
    actor,
    materialId: created.value.materialId,
    revisionId: created.value.revisionId,
  });
  if (!validated.ok) {
    throw new Error(`Local Material validation failed: ${validated.error.code}`);
  }

  const published = await authoring.publishRevision({
    actor,
    idempotencyKey: publishIdempotencyKey,
    materialId: created.value.materialId,
    revisionId: created.value.revisionId,
    expectedPublishedRevisionId: null,
  });
  if (!published.ok) {
    throw new Error(`Local Material publish failed: ${published.error.code}`);
  }

  return Object.freeze({
    materialId: created.value.materialId,
    revisionId: created.value.revisionId,
    slug,
  });
}

async function ensureReferenceData(database: PlatformDatabase): Promise<void> {
  await database
    .insertInto("topics")
    .values({ id: topicId, slug: "platform", name: "Platform" })
    .onConflict((conflict) => conflict.column("id").doNothing())
    .execute();
  await database
    .insertInto("formats")
    .values({ id: formatId, slug: "guide", name: "Guide" })
    .onConflict((conflict) => conflict.column("id").doNothing())
    .execute();
}
