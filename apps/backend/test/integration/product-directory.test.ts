import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { transactionHandle } from "../../src/infrastructure/prisma/index.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { assembleProductMaterialReading } from "../../src/modules/materials/index.js";
import {
  ProductDirectory,
  ProductOutlines,
  PublishedProductComposition,
  ProductCompositionsReading,
} from "../../src/modules/products/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe("Products directory over owner publication facts", () => {
  let db: TestDatabase;
  let directory: ProductDirectory;
  let compositions: ProductCompositionsReading;
  const productId = randomUUID();
  const chapterA = randomUUID();
  const chapterB = randomUUID();
  const actor = randomUUID();
  const topicId = randomUUID();
  const sourceId = `directory:${randomUUID()}`;
  const draftSource = `directory:${randomUUID()}`;
  let publishedId: string;
  let draftId: string;

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    await db.prisma.account.create({
      data: {
        id: actor,
        logtoIssuer: "https://directory.test",
        logtoSubject: actor,
      },
    });
    await db.prisma.topic.create({
      data: { id: topicId, name: "Directory", slug: `directory-${topicId}` },
    });
    await db.prisma.product.create({
      data: {
        id: productId,
        name: "Directory product",
        slug: `directory-${productId}`,
      },
    });
    await db.prisma.productChapter.createMany({
      data: [
        { id: chapterA, productId, name: "First", ordinal: 1 },
        { id: chapterB, productId, name: "Second", ordinal: 2 },
      ],
    });
    const materials = assembleMaterials({
      prisma: db.prisma,
      authorPolicy: { canManage: () => true },
    });
    async function reserve(sourceId: string, published: boolean) {
      const source = {
        id: sourceId,
        path: `${sourceId}.md`,
        revision: "a".repeat(64),
        version: 2 as const,
      };
      const reserved = await materials.authoring.reserveSourceMaterial({
        actor,
        source,
      });
      if (!reserved.ok) throw new Error(reserved.error.code);
      if (published) {
        const applied = await materials.authoring.applySourceMaterial({
          actor,
          source,
          idempotencyKey: sourceId,
          materialId: reserved.value.materialId,
          expectedContentVersion: reserved.value.contentVersion,
          publicationState: "published",
          primaryVideoId: null,
          body: representativeDocument("Directory lesson"),
          metadata: {
            title: "Published directory lesson",
            summary: "Lesson",
            access: "free",
            topicId,
            formatId: "guide",
            tagIds: [],
            productIds: [],
            difficulty: null,
            outcomes: [],
          },
        });
        if (!applied.ok) throw new Error(applied.error.code);
      }
      return reserved.value.materialId;
    }
    publishedId = await reserve(sourceId, true);
    draftId = await reserve(draftSource, false);
    await db.prisma.productMembership.createMany({
      data: [
        { productId: productId, materialId: publishedId },
        { productId: productId, materialId: draftId },
      ],
    });
    await db.prisma.productProgrammePlacement.createMany({
      data: [
        {
          id: randomUUID(),
          productId,
          materialId: publishedId,
          chapterId: chapterA,
          ordinal: 1,
        },
        {
          id: randomUUID(),
          productId,
          materialId: publishedId,
          chapterId: chapterB,
          ordinal: 2,
        },
        {
          id: randomUUID(),
          productId,
          materialId: draftId,
          chapterId: chapterA,
          ordinal: 3,
        },
      ],
    });
    const reading = assembleProductMaterialReading(db.prisma);
    compositions = new ProductCompositionsReading(db.prisma, reading);
    directory = new ProductDirectory(db.prisma, reading, compositions);
  });
  afterAll(async () => db.dispose());

  test("preserves repeated programme chapters while exposing only actual published Material identity", async () => {
    const [product] = await directory.products({ ids: [productId] });
    expect(product?.chapters.map(({ id }) => id)).toEqual([chapterA, chapterB]);
    expect(await directory.placements(productId, [sourceId])).toEqual([
      {
        sourceId,
        materialId: publishedId,
        chapterId: chapterA,
        published: true,
      },
      {
        sourceId,
        materialId: publishedId,
        chapterId: chapterB,
        published: true,
      },
    ]);
    const materials = await directory.materialsBySource([
      sourceId,
      draftSource,
      "unknown-source",
    ]);
    expect(
      materials.find((material) => material.materialId === publishedId)
        ?.published,
    ).toMatchObject({ title: "Published directory lesson" });
    expect(
      materials.find((material) => material.materialId === draftId),
    ).toEqual({ sourceId: draftSource, materialId: draftId, published: null });
    expect(materials).toHaveLength(2);
    const published = new PublishedProductComposition(
      db.prisma,
      assembleProductMaterialReading(db.prisma),
      compositions,
    );
    expect(await published.read(productId)).toEqual({
      ok: true,
      value: [publishedId],
    });
    const outlines = await new ProductOutlines(
      db.prisma,
      assembleProductMaterialReading(db.prisma),
      compositions,
    ).list();
    expect(
      outlines.ok &&
        outlines.value.find((product) => product.id === productId)?.chapters,
    ).toEqual([
      { id: chapterA, name: "First", materialIds: [publishedId] },
      { id: chapterB, name: "Second", materialIds: [publishedId] },
    ]);
  });

  test("binds exact source and current publication on the caller connection and preserves rollback", async () => {
    await expect(
      db.prisma.$transaction(async (transaction) => {
        await transaction.material.update({
          where: { id: publishedId },
          data: { publicationState: "unpublished" },
        });
        const first =
          await transaction.productProgrammePlacement.findFirstOrThrow({
            where: { productId, materialId: publishedId },
            orderBy: { ordinal: "asc" },
          });
        await transaction.productProgrammePlacement.update({
          where: { id: first.id },
          data: { chapterId: chapterB },
        });
        expect(
          await directory.lockPrimaryPlacement(
            transactionHandle(transaction),
            productId,
            sourceId,
          ),
        ).toEqual({
          sourceId,
          materialId: publishedId,
          chapterId: chapterB,
          published: false,
        });
        expect(
          await directory.lockPrimaryPlacement(
            transactionHandle(transaction),
            productId,
            "wrong-source",
          ),
        ).toBeNull();
        throw new Error("caller rollback");
      }),
    ).rejects.toThrow("caller rollback");
    expect(
      await db.prisma.$transaction((transaction) =>
        directory.lockPrimaryPlacement(
          transactionHandle(transaction),
          productId,
          sourceId,
        ),
      ),
    ).toEqual({
      sourceId,
      materialId: publishedId,
      chapterId: chapterA,
      published: true,
    });
  });
});
