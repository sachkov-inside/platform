import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import {
  ProductCatalogue,
  ProductCoverSelection,
} from "../../src/modules/products/index.js";
import { transactionHandle } from "../../src/infrastructure/prisma/transaction-handle.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let database: TestDatabase;
beforeAll(async () => {
  database = await createMigratedTestDatabase();
});
afterAll(async () => {
  await database.dispose();
});

test("Product archive facts track catalogue membership even when content is unpublished", async () => {
  const productId = randomUUID();
  const topicId = randomUUID();
  const actor = randomUUID();
  await database.prisma.product.create({
    data: {
      id: productId,
      slug: "catalogue-owner",
      name: "Catalogue owner",
      archivedAt: new Date("2026-10-01"),
    },
  });
  await database.prisma.topic.create({
    data: { id: topicId, slug: "catalogue-topic", name: "Topic" },
  });
  const materials = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: { canManage: () => true },
  });
  const draft = await materials.authoring.createDraft({
    actor,
    idempotencyKey: "catalogue-draft",
    body: representativeDocument("Catalogue"),
    metadata: {
      title: "Catalogue",
      summary: "Catalogue",
      access: "free",
      topicId,
      formatId: "guide",
      seriesIds: [],
      tagIds: [],
      difficulty: null,
      outcomes: [],
    },
  });
  if (!draft.ok) throw new Error(draft.error.code);
  // Migration/fixture setup can link an archived Product; authoring prohibits new links to it.
  await database.prisma.productMembership.create({
    data: {
      seriesId: productId,
      materialId: draft.value.materialId,
    },
  });
  const catalogue = new ProductCatalogue(database.prisma);
  expect(await catalogue.materialAccessFacts([draft.value.materialId])).toEqual(
    new Map([
      [draft.value.materialId, { productIds: [productId], archivedOnly: true }],
    ]),
  );
  await database.prisma.product.update({
    where: { id: productId },
    data: { archivedAt: null },
  });
  expect(await catalogue.materialAccessFacts([draft.value.materialId])).toEqual(
    new Map([[draft.value.materialId, { productIds: [productId] }]]),
  );
  const upper = draft.value.materialId.toUpperCase();
  expect(
    await catalogue.materialAccessFacts([upper, draft.value.materialId]),
  ).toEqual(
    new Map([
      [upper, { productIds: [productId] }],
      [draft.value.materialId, { productIds: [productId] }],
    ]),
  );
  expect(await catalogue.materialAccessFacts([randomUUID()])).toEqual(
    new Map(),
  );
});

test("Product cover selection joins the caller transaction and rolls back with it", async () => {
  const id = randomUUID();
  await database.prisma.product.create({
    data: { id, slug: "cover-owner", name: "Cover owner" },
  });
  const selection = new ProductCoverSelection();
  const owner = { kind: "series", id };
  const missingCoverId = randomUUID();
  await database.prisma.contentCover.create({
    data: {
      id: missingCoverId,
      seriesId: id,
      state: "ready",
      uploadConfirmed: true,
    },
  });
  await expect(
    database.prisma.$transaction(async (tx) => {
      const handle = transactionHandle(tx);
      expect(await selection.read(owner, handle)).toEqual({
        coverId: null,
        sourceId: null,
      });
      // The lifecycle owner validates cover readiness before asking Products to select it.
      await selection.write(owner, missingCoverId, handle);
      expect(await selection.references(owner, missingCoverId, handle)).toBe(
        true,
      );
      throw new Error("caller rollback");
    }),
  ).rejects.toThrow("caller rollback");
  await database.prisma.$transaction(async (tx) => {
    expect(await selection.read(owner, transactionHandle(tx))).toEqual({
      coverId: null,
      sourceId: null,
    });
  });
});
