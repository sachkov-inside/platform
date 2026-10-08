import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { PublicContentTargets } from "../../src/modules/materials/index.js";
import { validateTargets } from "../../src/modules/communications/features/validate-targets/validate-targets.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";

describe("communications promised public targets against Materials PostgreSQL", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createMigratedTestDatabase();
  });
  afterAll(async () => {
    await database.dispose();
  });
  test("validates public Product pages independently of protected programme contents", async () => {
    const productId = randomUUID();
    await database.prisma.product.create({
      data: { id: productId, slug: "public-product", name: "Public Product" },
    });
    const targets = new PublicContentTargets(database.prisma);
    const validate = (url: string) =>
      validateTargets(
        [
          {
            partId: randomUUID(),
            content: {
              type: "text",
              text: "Product",
              entities: [],
              buttons: [{ text: "Open", url }],
            },
          },
        ],
        "https://inside.example",
        targets,
      );
    for (const route of ["products", "series", "guides"]) {
      expect(
        await validate(`https://inside.example/${route}/public-product`),
      ).toEqual([]);
      expect(
        await validate(`https://inside.example/${route}/missing-product`),
      ).toEqual([
        {
          url: `https://inside.example/${route}/missing-product`,
          targetId: null,
          reason: "not_found",
        },
      ]);
    }
    expect(
      await validate("https://external.example/products/missing-product"),
    ).toEqual([]);
    for (const suffix of [
      "?redirect=evil",
      "#fragment",
      "/extra",
      "/",
      "%2f",
      "%ZZ",
    ]) {
      const url = `https://inside.example/products/public-product${suffix}`;
      expect(await validate(url)).toEqual([
        { url, targetId: null, reason: "not_found" },
      ]);
    }
    await database.prisma.product.update({
      where: { id: productId },
      data: { archivedAt: new Date("2026-01-01T00:00:00Z") },
    });
    expect(
      await validate("https://inside.example/products/public-product"),
    ).toEqual([
      {
        url: "https://inside.example/products/public-product",
        targetId: productId,
        reason: "not_published",
      },
    ]);
  });
  test("detects unpublished, paid, missing and incomplete targets through the owning Materials seam", async () => {
    const actor = randomUUID();
    const authoring = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: () => true },
    }).authoring;
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: randomUUID(),
      metadata: {
        title: "Target",
        summary: "Summary",
        access: "free",
        topicId: null,
        formatId: null,
        tagIds: [],
        difficulty: null,
        outcomes: [],
        seriesIds: [],
      },
      body: representativeDocument("Target body"),
    });
    if (!created.ok) throw new Error(created.error.code);
    const materialId = created.value.materialId;
    // Shape setup stays in this isolated fixture. Product reads go through the public facet.
    await database.prisma.material.update({
      where: { id: materialId },
      data: { slug: "public-target" },
    });
    const targets = new PublicContentTargets(database.prisma);
    expect(
      await targets.check({ kind: "material", slug: "public-target" }),
    ).toEqual({ targetId: materialId, reason: "not_published" });
    expect(await targets.check({ kind: "material", slug: "missing" })).toEqual({
      targetId: null,
      reason: "not_found",
    });
    const seriesId = randomUUID();
    await database.prisma.product.create({
      data: { id: seriesId, slug: "test-series", name: "Series" },
    });
    expect(
      await targets.check({ kind: "series", slug: "test-series" }),
    ).toEqual({ targetId: seriesId, reason: "incomplete" });
    await database.prisma.productMembership.create({
      data: { seriesId, materialId, ordinal: 1 },
    });
    expect(
      (await targets.check({ kind: "series", slug: "test-series" })).reason,
    ).toBe("incomplete");
    const topicId = randomUUID();
    const formatId = "note";
    await database.prisma.topic.create({
      data: { id: topicId, slug: "target-topic", name: "Target topic" },
    });

    const metadata = {
      title: "Target",
      summary: "Summary",
      access: "free" as const,
      topicId,
      formatId,
      tagIds: [],
      difficulty: null,
      outcomes: [],
      seriesIds: [seriesId],
    };
    const published = await authoring.saveMaterial({
      actor,
      materialId,
      expectedContentVersion: 1,
      idempotencyKey: randomUUID(),
      publicationState: "published",
      metadata,
      body: representativeDocument("Target body"),
    });
    if (!published.ok) throw new Error(published.error.code);
    expect(
      await targets.check({ kind: "material", slug: "public-target" }),
    ).toEqual({ targetId: materialId, reason: "eligible" });
    expect(
      await targets.check({ kind: "series", slug: "test-series" }),
    ).toEqual({ targetId: seriesId, reason: "eligible" });
    const paid = await authoring.saveMaterial({
      actor,
      materialId,
      expectedContentVersion: published.value.contentVersion,
      idempotencyKey: randomUUID(),
      publicationState: "published",
      metadata: { ...metadata, access: "closed" },
      body: representativeDocument("Target body"),
    });
    if (!paid.ok) throw new Error(paid.error.code);
    expect(
      (await targets.check({ kind: "material", slug: "public-target" })).reason,
    ).toBe("not_free");
    expect(
      (await targets.check({ kind: "series", slug: "test-series" })).reason,
    ).toBe("not_free");
    const unpublished = await authoring.saveMaterial({
      actor,
      materialId,
      expectedContentVersion: paid.value.contentVersion,
      idempotencyKey: randomUUID(),
      publicationState: "unpublished",
      metadata,
      body: representativeDocument("Target body"),
    });
    if (!unpublished.ok) throw new Error(unpublished.error.code);
    const links = [
      {
        partId: randomUUID(),
        content: {
          type: "text" as const,
          text: "Target",
          entities: [],
          buttons: [
            {
              text: "Read",
              url: "https://inside.example/materials/public-target",
            },
            {
              text: "Missing",
              url: "https://inside.example/materials/missing",
            },
            {
              text: "External",
              url: "https://external.example/materials/missing",
            },
          ],
        },
      },
    ];
    const bare = [
      {
        partId: randomUUID(),
        content: {
          type: "text" as const,
          text: "inside.example/materials/missing",
          entities: [{ type: "url" as const, offset: 0, length: 32 }],
          buttons: [],
        },
      },
    ];
    expect(
      await validateTargets(bare, "https://inside.example", targets),
    ).toEqual([
      {
        url: "https://inside.example/materials/missing",
        targetId: null,
        reason: "not_found",
      },
    ]);
    const malformed = [
      {
        partId: randomUUID(),
        content: {
          type: "text" as const,
          text: "https://inside.example/materials/%ZZ",
          entities: [],
          buttons: [],
        },
      },
    ];
    expect(
      await validateTargets(malformed, "https://inside.example", targets),
    ).toEqual([
      {
        url: "https://inside.example/materials/%ZZ",
        targetId: null,
        reason: "not_found",
      },
    ]);
    expect(
      await validateTargets(links, "https://inside.example", targets),
    ).toEqual([
      {
        url: "https://inside.example/materials/public-target",
        targetId: materialId,
        reason: "not_published",
      },
      {
        url: "https://inside.example/materials/missing",
        targetId: null,
        reason: "not_found",
      },
    ]);
  });
});
