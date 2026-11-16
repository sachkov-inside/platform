import {
  readingMaterials,
  readingProduct,
  readingTopic,
} from "../../../../scenarios/reading.mjs";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import {
  assembleAccounts,
  bootstrapOwnerAccount,
} from "../../src/modules/accounts/index.js";
import type { TestDatabase } from "../integration/setup/test-database.js";

/** Test-owned database only. No notification worker, bank or messaging provider is assembled. */
export async function seedReadingScenario(
  database: Pick<TestDatabase, "url" | "prisma">,
) {
  const expectedDatabase = new URL(database.url).pathname.slice(1);
  if (!/^inside_test_[a-f0-9]{32}$/u.test(expectedDatabase)) {
    throw new Error("Reading scenario requires an isolated test database");
  }
  const actual = await database.prisma.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  if (actual[0]?.name !== expectedDatabase)
    throw new Error("Reading scenario database ownership mismatch");
  const owner = await bootstrapOwnerAccount(
    database.prisma,
    {
      issuer: "https://synthetic-scenarios.invalid",
      subject: "reading-owner",
    },
    "platform:admin",
  );
  const accounts = assembleAccounts({
    prisma: database.prisma,
    emailFingerprintKey: "synthetic-reading-scenario-email-key",
  });
  const materials = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: {
      async canManage(accountId, transaction) {
        const decision = await accounts.checkPermission(
          { accountId, permission: "materials:manage" },
          transaction,
        );
        if (!decision.ok) throw new Error(decision.error.code);
        return decision.allowed;
      },
    },
  });
  const actor = owner.accountId;
  const topic = await materials.authoring.createContentCollection({
    actor,
    kind: "topic",
    name: readingTopic.name,
    slug: readingTopic.slug,
    summary: "Synthetic reading scenario",
  });
  const product = await materials.authoring.createContentCollection({
    actor,
    kind: "product",
    name: readingProduct.name,
    slug: readingProduct.slug,
    summary: "Synthetic reading scenario",
  });
  if (!topic.ok) throw new Error(topic.error.code);
  if (!product.ok) throw new Error(product.error.code);
  const materialIds = new Map<string, string>();
  for (const fact of readingMaterials.slice(0, 18)) {
    const metadata = {
      title: fact.title,
      summary: fact.summary,
      access: fact.access,
      difficulty: "basic" as const,
      outcomes: [],
      topicId: topic.value.id,
      formatId: fact.format,
      tagIds: [],
      productIds: [product.value.id],
    };
    const body = {
      schemaVersion: 1,
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: fact.summary }],
          },
        ],
      },
    };
    const created = await materials.authoring.createDraft({
      actor,
      metadata,
      body,
      idempotencyKey: `reading-create-${fact.materialId}`,
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.saveMaterial({
      actor,
      materialId: created.value.materialId,
      expectedContentVersion: created.value.contentVersion,
      idempotencyKey: `reading-publish-${fact.materialId}`,
      publicationState: "published",
      notifyTelegram: false,
      metadata,
      body,
    });
    if (!published.ok) throw new Error(published.error.code);
    materialIds.set(fact.materialId, created.value.materialId);
  }
  return {
    materials,
    materialIds,
    productId: product.value.id,
    ownerId: actor,
  };
}
