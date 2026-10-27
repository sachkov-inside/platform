import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  ProductCompositions,
  ProductCompositionsReading,
  PublishedProductComposition,
} from "../../src/modules/products/index.js";
import { assembleProductMaterialReading } from "../../src/modules/materials/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

let db: TestDatabase;
beforeAll(async () => {
  db = await createMigratedTestDatabase();
});
afterAll(async () => {
  await db.dispose();
});

async function fixture() {
  const productId = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  await db.prisma.product.create({
    data: { id: productId, name: "Snapshot", slug: `snapshot-${productId}` },
  });
  await db.prisma.material.createMany({
    data: [first, second].map((id) => ({
      id,
      createdBy: randomUUID(),
      body: { type: "doc", content: [] },
      schemaVersion: 1,
      access: "free",
      publicationState: "draft",
      contentVersion: 1n,
    })),
  });
  await db.prisma.productMembership.createMany({
    data: [first, second].map((materialId) => ({
      productId: productId,
      materialId,
    })),
  });
  await db.prisma.productProgrammePlacement.create({
    data: { id: randomUUID(), productId, materialId: first, ordinal: 1 },
  });
  return { productId, first, second };
}

test("composition keeps one Products snapshot when archive and programme change between reads", async () => {
  const { productId, first, second } = await fixture();
  let changed = false;
  const interleaved = db.prisma.$extends({
    query: {
      $allOperations: async ({ args, query }) => {
        const result: unknown = await query(args);
        if (!changed) {
          changed = true;
          await db.prisma.$transaction(async (tx) => {
            await tx.product.update({
              where: { id: productId },
              data: { archivedAt: new Date("2026-10-01") },
            });
            await tx.productProgrammePlacement.updateMany({
              where: { productId },
              data: { materialId: second },
            });
          });
        }
        return result;
      },
    },
  });
  const compositions = new ProductCompositionsReading(
    interleaved,
    assembleProductMaterialReading(db.prisma),
  );
  const [snapshot] = await compositions.load({ ids: [productId] }, 1);
  expect(changed).toBe(true);
  expect({
    archived: snapshot?.archived,
    programme: snapshot?.programmePlacements.map((row) => row.materialId),
  }).toEqual({ archived: false, programme: [first] });
  const [after] = await new ProductCompositionsReading(
    db.prisma,
    assembleProductMaterialReading(db.prisma),
  ).load({ ids: [productId] }, 1);
  expect({
    archived: after?.archived,
    programme: after?.programmePlacements.map((row) => row.materialId),
  }).toEqual({ archived: true, programme: [second] });
});

test("oversized catalogue is rejected before loading any Material facts", async () => {
  const productId = randomUUID();
  await db.prisma.product.create({
    data: { id: productId, name: "Oversized", slug: `oversized-${productId}` },
  });
  const ids = Array.from({ length: 10005 }, () => randomUUID());
  // No cross-owner foreign key is needed to reject malformed/legacy owner data before enrichment.
  for (let offset = 0; offset < ids.length; offset += 500)
    await db.prisma.productMembership.createMany({
      data: ids
        .slice(offset, offset + 500)
        .map((materialId) => ({ productId: productId, materialId })),
    });
  const materials = assembleProductMaterialReading(db.prisma);
  let enriched = false;
  const compositions = new ProductCompositions(db.prisma);
  await expect(
    compositions.load({ ids: [productId] }, 1, {
      async load(materialIds) {
        enriched = true;
        return (await materials.read({ ids: materialIds })).map((row) => ({
          id: row.id,
          sourceId: row.sourceId,
          published: row.published !== null,
          topicId: row.topicId,
          hasModeVariants: row.hasModeVariants,
        }));
      },
    }),
  ).rejects.toThrow("Product composition exceeds its bound");
  expect(enriched).toBe(false);
  expect(
    await new PublishedProductComposition(db.prisma, materials).read(productId),
  ).toEqual({ ok: false, error: { code: "product_too_large" } });
});

test("composition joins the caller handle without a nested transaction or a second connection", async () => {
  const { transactionHandle } =
    await import("../../src/infrastructure/prisma/index.js");
  const { productId } = await fixture();
  const compositions = new ProductCompositionsReading(
    db.prisma,
    assembleProductMaterialReading(db.prisma),
  );
  await expect(
    db.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: { archivedAt: new Date("2026-10-01") },
      });
      const [inside] = await compositions.load(
        { ids: [productId] },
        1,
        transactionHandle(tx),
      );
      expect(inside?.archived).toBe(true);
      throw new Error("caller rollback");
    }),
  ).rejects.toThrow("caller rollback");
  const [outside] = await compositions.load({ ids: [productId] }, 1);
  expect(outside?.archived).toBe(false);
});
