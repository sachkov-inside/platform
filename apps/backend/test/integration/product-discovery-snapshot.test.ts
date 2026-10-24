import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ProductDiscovery } from "../../src/modules/products/index.js";
import { transactionHandle } from "../../src/infrastructure/prisma/index.js";
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
    second = randomUUID(),
    extra = randomUUID();
  await db.prisma.product.create({
    data: {
      id: productId,
      name: "Discovery snapshot",
      slug: `discovery-${productId}`,
    },
  });
  await db.prisma.productMembership.create({
    data: { seriesId: productId, materialId: first },
  });
  await db.prisma.productProgrammePlacement.create({
    data: {
      id: randomUUID(),
      productId,
      materialId: first,
      ordinal: 1,
      stepGroup: "Start",
    },
  });
  await db.prisma.publishedMaterialProductMembership.create({
    data: { seriesId: productId, materialId: first },
  });
  return { productId, first, second, extra };
}

test("discovery keeps catalogue, published ordinals, authored groups and archive state in one Products snapshot", async () => {
  const { productId, first, second, extra } = await fixture();
  let changed = false;
  let reads = 0;
  let releasePublished: () => void = () => {
    throw new Error("Publication gate is not initialized");
  };
  const changedState = new Promise<void>((resolve) => {
    releasePublished = resolve;
  });
  const replace = async () => {
    if (changed) return;
    changed = true;
    await db.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: { archivedAt: new Date("2026-10-01") },
      });
      await tx.productProgrammePlacement.deleteMany({ where: { productId } });
      await tx.publishedMaterialProductMembership.deleteMany({
        where: { seriesId: productId },
      });
      await tx.productMembership.deleteMany({ where: { seriesId: productId } });
      await tx.productMembership.createMany({
        data: [extra, second].map((materialId) => ({
          seriesId: productId,
          materialId,
        })),
      });
      await tx.productProgrammePlacement.createMany({
        data: [extra, second].map((materialId, index) => ({
          id: randomUUID(),
          productId,
          materialId,
          ordinal: index + 1,
          stepGroup: "Release",
        })),
      });
      await tx.publishedMaterialProductMembership.createMany({
        data: [extra, second].map((materialId) => ({
          seriesId: productId,
          materialId,
        })),
      });
    });
    releasePublished();
  };
  const interleaved = db.prisma.$extends({
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        if (
          model === "PublishedMaterialProductMembership" &&
          operation === "findMany"
        )
          await changedState;
        reads += 1;
        const result: unknown = await query(args);
        if (
          (model === "ProductMembership" && operation === "findMany") ||
          operation === "$queryRaw"
        )
          await replace();
        return result;
      },
    },
  });
  // The extension only controls real PostgreSQL operation ordering; all facts come from the owner.
  const observed = new Proxy(db.prisma, {
    get(_target, key): unknown {
      const value: unknown = Reflect.get(interleaved, key);
      return typeof value === "function" ? value.bind(interleaved) : value;
    },
  });
  const before = await new ProductDiscovery(observed).snapshot();
  expect(changed).toBe(true);
  expect(
    before.products.find((entry) => entry.id === productId)?.archivedAt,
  ).toBeNull();
  expect(
    before.memberships.filter((entry) => entry.seriesId === productId),
  ).toEqual([
    {
      seriesId: productId,
      materialId: first,
      ordinal: 1,
      chapterId: null,
      stepGroup: "Start",
    },
  ]);
  expect(
    before.publishedMemberships.filter((entry) => entry.seriesId === productId),
  ).toEqual([{ seriesId: productId, materialId: first, ordinal: 1 }]);
  expect(reads).toBe(1);
  const after = await new ProductDiscovery(db.prisma).snapshot();
  expect(
    after.products.find((entry) => entry.id === productId)?.archivedAt,
  ).toEqual(new Date("2026-10-01"));
  expect(
    after.memberships.find(
      (entry) => entry.seriesId === productId && entry.materialId === second,
    ),
  ).toMatchObject({ ordinal: 2, stepGroup: "Release" });
  expect(
    after.publishedMemberships.find(
      (entry) => entry.seriesId === productId && entry.materialId === second,
    )?.ordinal,
  ).toBe(2);
});

test("discovery reads and rolls back the exact caller transaction without a second connection", async () => {
  const { productId, first } = await fixture();
  const discovery = new ProductDiscovery(db.prisma);
  await expect(
    db.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: { archivedAt: new Date("2026-10-01") },
      });
      await tx.productProgrammePlacement.updateMany({
        where: { productId },
        data: { stepGroup: "Uncommitted" },
      });
      const inside = await discovery.snapshot(transactionHandle(tx));
      expect(
        inside.products.find((entry) => entry.id === productId)?.archivedAt,
      ).not.toBeNull();
      expect(
        inside.memberships.find(
          (entry) => entry.seriesId === productId && entry.materialId === first,
        )?.stepGroup,
      ).toBe("Uncommitted");
      throw new Error("caller rollback");
    }),
  ).rejects.toThrow("caller rollback");
  const outside = await discovery.snapshot();
  expect(
    outside.products.find((entry) => entry.id === productId)?.archivedAt,
  ).toBeNull();
  expect(
    outside.memberships.find(
      (entry) => entry.seriesId === productId && entry.materialId === first,
    )?.stepGroup,
  ).toBe("Start");
});

test("discovery preserves first occurrence metadata and deterministic catalogue-only ordinals", async () => {
  const { productId, first, second, extra } = await fixture();
  const another = randomUUID();
  await db.prisma.productMembership.createMany({
    data: [second, extra, another].map((materialId) => ({
      seriesId: productId,
      materialId,
    })),
  });
  await db.prisma.productProgrammePlacement.createMany({
    data: [
      {
        id: randomUUID(),
        productId,
        materialId: second,
        ordinal: 2,
        stepGroup: "Next",
      },
      {
        id: randomUUID(),
        productId,
        materialId: first,
        ordinal: 3,
        stepGroup: "Repeat",
      },
    ],
  });
  const snapshot = await new ProductDiscovery(db.prisma).snapshot();
  const memberships = snapshot.memberships.filter(
    (entry) => entry.seriesId === productId,
  );
  expect(memberships.find((entry) => entry.materialId === first)).toMatchObject(
    { ordinal: 1, stepGroup: "Start" },
  );
  expect(
    memberships.find((entry) => entry.materialId === second),
  ).toMatchObject({ ordinal: 2, stepGroup: "Next" });
  for (const [index, materialId] of [extra, another].sort().entries()) {
    expect(
      memberships.find((entry) => entry.materialId === materialId),
    ).toMatchObject({ ordinal: 4 + index, chapterId: null, stepGroup: null });
  }
});
