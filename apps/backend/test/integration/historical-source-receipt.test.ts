import { afterEach, expect, test } from "vitest";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { applySourceBodySchema } from "../../src/modules/materials/features/import-source-material/import-source-material.contract.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { materialBodyOperations } from "../../src/modules/materials/index.js";
import { fingerprintCommand } from "../../src/modules/materials/shared/canonical-command-fingerprint.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { migrateThrough, upgradeToLatest } from "./setup/historical-upgrade.js";
let database: TestDatabase | undefined;
afterEach(async () => database?.dispose());
const actor = "11111111-1111-4111-8111-111111111111";
const otherManager = "44444444-4444-4444-8444-444444444444";
const materialId = "22222222-2222-4222-8222-222222222222";
test("historical Source v1 lookup preserves original fingerprint, feed archive and receipt without any mutation", async () => {
  database = await createTestDatabase();
  await migrateThrough(database, "0112_canonical_product_storage");
  const source = {
    id: "opaque:series-source",
    path: "original.md",
    revision: "a".repeat(64),
    showInFeed: false,
  };
  const metadata = {
    title: "Original",
    summary: null,
    access: "membership" as const,
    difficulty: null,
    outcomes: [],
    topicId: null,
    formatId: "note" as const,
    tagIds: [],
    seriesIds: [],
  };
  const body = representativeDocument(
    "Authored series and showInFeed remain literal text",
  );
  const accepted = materialBodyOperations.accept(body, {
    assignMissingNodeIds: false,
  });
  if (!accepted.ok) throw new Error(accepted.error.code);
  const request = {
    source,
    metadata,
    body,
    materialId,
    expectedContentVersion: 7,
    publicationState: "draft" as const,
    primaryVideoId: null,
  };
  const fingerprint = fingerprintCommand({
    operation: "save_material",
    ...request,
    body: accepted.value,
    deleteVideoId: null,
    videoChapters: null,
    confirmedProductRemovals: [],
  });
  await database.prisma.$executeRaw(
    Prisma.sql`insert into materials.materials(id,title,access,publication_state,content_version,source_id,source_path,source_revision,show_in_feed,schema_version,body,created_by) values (${materialId}::uuid,'Original','closed','draft',8,${source.id},${source.path},${source.revision},false,1,${JSON.stringify(body.doc)}::jsonb,${actor}::uuid)`,
  );
  await database.prisma.authoringIdempotency.create({
    data: {
      actorId: actor,
      operation: "save_material",
      idempotencyKey: "original-key",
      requestFingerprint: fingerprint,
      materialId,
      contentVersion: 8n,
      publicationState: "draft",
    },
  });
  const receipts = await database.prisma.authoringIdempotency.findMany();
  await upgradeToLatest(database);
  const authoring = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: { canManage: (id) => id === actor || id === otherManager },
  }).authoring;
  const before = await database.prisma.material.findMany();
  const command = { ...request, actor, idempotencyKey: "original-key" };
  expect(await authoring.readHistoricalSourceMaterialReceipt(command)).toEqual({
    ok: true,
    value: {
      materialId,
      contentVersion: 8,
      publicationState: "draft",
      publishedAt: null,
    },
  });
  expect(
    await authoring.readHistoricalSourceMaterialReceipt(command),
  ).toMatchObject({ ok: true });
  expect(
    await authoring.readHistoricalSourceMaterialReceipt({
      ...command,
      source: { ...source, showInFeed: true },
    }),
  ).toEqual({ ok: false, error: { code: "idempotency_conflict" } });
  expect(
    await authoring.readHistoricalSourceMaterialReceipt({
      ...command,
      idempotencyKey: "fresh-key",
    }),
  ).toEqual({ ok: false, error: { code: "historical_receipt_not_found" } });
  expect(
    await authoring.readHistoricalSourceMaterialReceipt({
      ...command,
      actor: "33333333-3333-4333-8333-333333333333",
    }),
  ).toEqual({ ok: false, error: { code: "forbidden" } });
  expect(
    await authoring.readHistoricalSourceMaterialReceipt({
      ...command,
      actor: otherManager,
    }),
  ).toEqual({ ok: false, error: { code: "historical_receipt_not_found" } });
  expect(
    await authoring.readHistoricalSourceMaterialReceipt(command),
  ).toMatchObject({
    ok: true,
    value: { materialId, contentVersion: 8 },
  });
  expect(applySourceBodySchema.safeParse(request).success).toBe(false);
  expect(await database.prisma.material.findMany()).toEqual(before);
  expect(await database.prisma.authoringIdempotency.findMany()).toEqual(
    receipts,
  );
  expect(
    await database.prisma.$queryRaw(
      Prisma.sql`select original from materials.historical_source_records where material_id=${materialId}::uuid`,
    ),
  ).toEqual([{ original: { ...source, commit: null } }]);
  expect(
    await database.prisma.$queryRaw(
      Prisma.sql`select column_name from information_schema.columns where table_schema='materials' and table_name='materials' and column_name='show_in_feed'`,
    ),
  ).toEqual([]);
});
