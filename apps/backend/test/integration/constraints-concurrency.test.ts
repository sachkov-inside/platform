import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { assembleMaterials } from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const actor = "a0000000-0000-4000-8000-000000000001";
const topicId = "a0000000-0000-4000-8000-000000000002";
const formatId = "a0000000-0000-4000-8000-000000000003";
const tagId = "a0000000-0000-4000-8000-000000000004";
const seriesId = "a0000000-0000-4000-8000-000000000005";
const secondSeriesId = "a0000000-0000-4000-8000-000000000006";

describe("material authoring integrity contract", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await testDatabase.prisma.topic.create({
      data: { id: topicId, slug: "product", name: "Product" },
    });
    await testDatabase.prisma.format.create({
      data: { id: formatId, slug: "text", name: "Text" },
    });
    await testDatabase.prisma.tag.create({
      data: { id: tagId, name: "Platform", normalizedName: "platform" },
    });
    await testDatabase.prisma.series.createMany({
      data: [
        { id: seriesId, slug: "build", name: "Build" },
        { id: secondSeriesId, slug: "operate", name: "Operate" },
      ],
    });
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("rolls back invalid references including the idempotency claim", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const idempotencyKey = "a0000000-0000-4000-8000-000000000010";
    const base = {
      actor,
      idempotencyKey,
      metadata: {
        title: "Reference validation",
        summary: "Required references are checked once.",
        slug: "reference-validation",
        access: "free",
        topicId: "a0000000-0000-4000-8000-999999999999",
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument(),
    } as const;

    expect(await authoring.createDraft(base)).toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [{ code: "topic_not_found", path: "/metadata/topicId" }],
      },
    });

    expect(
      await authoring.createDraft({
        ...base,
        metadata: {
          ...base.metadata,
          topicId,
          formatId: "a0000000-0000-4000-8000-999999999998",
        },
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_reference",
        issues: [{ code: "format_not_found", path: "/metadata/formatId" }],
      },
    });

    const corrected = await authoring.createDraft({
      ...base,
      metadata: { ...base.metadata, topicId, formatId },
    });
    expect(corrected.ok).toBe(true);
  });

  test("maps unique slug, duplicate Tag and occupied Series ordinal consistently", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const metadata = {
      title: "Constraint owner",
      summary: "Database arbitrates races.",
      slug: "constraint-owner",
      access: "free",
      topicId,
      formatId,
      tagIds: [tagId],
      seriesMemberships: [{ seriesId, ordinal: 7 }],
    } as const;
    const first = await authoring.createDraft({
      actor,
      idempotencyKey: "a0000000-0000-4000-8000-000000000020",
      metadata,
      body: representativeDocument(),
    });
    expect(first.ok).toBe(true);

    expect(
      await authoring.createDraft({
        actor,
        idempotencyKey: "a0000000-0000-4000-8000-000000000021",
        metadata: { ...metadata, title: "Duplicate slug", seriesMemberships: [] },
        body: representativeDocument(),
      }),
    ).toEqual({
      ok: false,
      error: { code: "slug_conflict", slug: "constraint-owner" },
    });

    expect(
      await authoring.createDraft({
        actor,
        idempotencyKey: "a0000000-0000-4000-8000-000000000022",
        metadata: {
          ...metadata,
          slug: "duplicate-tag",
          tagIds: [tagId, tagId],
          seriesMemberships: [],
        },
        body: representativeDocument(),
      }),
    ).toEqual({ ok: false, error: { code: "duplicate_tag", tagId } });

    expect(
      await authoring.createDraft({
        actor,
        idempotencyKey: "a0000000-0000-4000-8000-000000000023",
        metadata: {
          ...metadata,
          title: "Ordinal contender",
          slug: "ordinal-contender",
          tagIds: [],
        },
        body: representativeDocument(),
      }),
    ).toEqual({
      ok: false,
      error: { code: "series_ordinal_conflict", seriesId, ordinal: 7 },
    });

    expect(
      await authoring.createDraft({
        actor,
        idempotencyKey: "a0000000-0000-4000-8000-000000000024",
        metadata: {
          ...metadata,
          title: "Later ordinal contender",
          slug: "later-ordinal-contender",
          tagIds: [],
          seriesMemberships: [
            { seriesId: secondSeriesId, ordinal: 1 },
            { seriesId, ordinal: 7 },
          ],
        },
        body: representativeDocument(),
      }),
    ).toEqual({
      ok: false,
      error: { code: "series_ordinal_conflict", seriesId, ordinal: 7 },
    });
  });

  test("arbitrates a concurrent Series ordinal race with stable conflict details", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const create = (side: "left" | "right", key: string) =>
      authoring.createDraft({
        actor,
        idempotencyKey: key,
        metadata: {
          title: `${side} ordinal contender`,
          summary: "The Series row lock selects one winner.",
          slug: `${side}-ordinal-contender`,
          access: "free",
          topicId,
          formatId,
          tagIds: [],
          seriesMemberships: [{ seriesId: secondSeriesId, ordinal: 11 }],
        },
        body: representativeDocument(),
      });

    const [left, right] = await Promise.all([
      create("left", "a0000000-0000-4000-8000-000000000025"),
      create("right", "a0000000-0000-4000-8000-000000000026"),
    ]);
    expect([left, right].filter((result) => result.ok)).toHaveLength(1);
    expect([left, right].find((result) => !result.ok)).toEqual({
      ok: false,
      error: {
        code: "series_ordinal_conflict",
        seriesId: secondSeriesId,
        ordinal: 11,
      },
    });
  });

  test("allows exactly one of two concurrent Saves from the same content version", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const metadata = {
      title: "Concurrent Save",
      summary: "The Material row lock selects one winner.",
      slug: "concurrent-material-save",
      access: "free",
      topicId,
      formatId,
      tagIds: [],
      seriesMemberships: [],
    } as const;
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: "a0000000-0000-4000-8000-000000000027",
      metadata,
      body: representativeDocument(),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }

    const save = (side: "left" | "right", key: string) =>
      authoring.saveMaterial({
        actor,
        idempotencyKey: key,
        materialId: created.value.materialId,
        expectedContentVersion: created.value.contentVersion,
        publicationState: "draft",
        metadata: { ...metadata, title: `${side} concurrent winner` },
        body: representativeDocument(),
      });
    const [left, right] = await Promise.all([
      save("left", "a0000000-0000-4000-8000-000000000028"),
      save("right", "a0000000-0000-4000-8000-000000000029"),
    ]);

    expect([left, right].filter((result) => result.ok)).toHaveLength(1);
    expect([left, right].find((result) => !result.ok)).toEqual({
      ok: false,
      error: {
        code: "stale_content_version",
        currentContentVersion: created.value.contentVersion + 1,
      },
    });
  });

  test("enforces the published slug lock below the application interface", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: "a0000000-0000-4000-8000-000000000030",
      metadata: {
        title: "Stable published slug",
        summary: "The public URL keeps its identity.",
        slug: "stable-published-slug",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument(),
    });
    if (!created.ok) {
      throw new Error(created.error.code);
    }

    const published = await authoring.saveMaterial({
      actor,
      idempotencyKey: "a0000000-0000-4000-8000-000000000031",
      materialId: created.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      metadata: {
        title: "Stable published slug",
        summary: "The public URL keeps its identity.",
        slug: "stable-published-slug",
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesMemberships: [],
      },
      body: representativeDocument(),
    });
    if (!published.ok) {
      throw new Error(published.error.code);
    }

    await expect(
      testDatabase.prisma.material.update({
        where: { id: created.value.materialId },
        data: { slug: "changed-published-slug" },
      }),
    ).rejects.toThrow("published Material slug is immutable");
  });
});
