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
        access: "free",
        topicId: "a0000000-0000-4000-8000-999999999999",
        formatId,
        tagIds: [],
        seriesIds: [],
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

  test("rejects duplicate Tags while appending selected Series", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const metadata = {
      title: "Constraint owner",
      summary: "Database arbitrates races.",
      access: "free",
      topicId,
      formatId,
      tagIds: [tagId],
      seriesIds: [seriesId],
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
        idempotencyKey: "a0000000-0000-4000-8000-000000000022",
        metadata: {
          ...metadata,
          tagIds: [tagId, tagId],
          seriesIds: [],
        },
        body: representativeDocument(),
      }),
    ).toEqual({ ok: false, error: { code: "duplicate_tag", tagId } });

    const second = await authoring.createDraft({
        actor,
        idempotencyKey: "a0000000-0000-4000-8000-000000000023",
        metadata: {
          ...metadata,
          title: "Second playlist item",
          tagIds: [],
        },
        body: representativeDocument(),
      });
    const third = await authoring.createDraft({
        actor,
        idempotencyKey: "a0000000-0000-4000-8000-000000000024",
        metadata: {
          ...metadata,
          title: "Third playlist item",
          tagIds: [],
        },
        body: representativeDocument(),
      });
    if (!first.ok || !second.ok || !third.ok) {
      throw new Error("Selected Series append failed");
    }
    const loaded = await Promise.all(
      [first, second, third].map((created) =>
        authoring.loadMaterial({
          actor,
          materialId: created.value.materialId,
        }),
      ),
    );
    for (const [index, result] of loaded.entries()) {
      if (!result.ok) throw new Error(result.error.code);
      expect(result.value.metadata.seriesMemberships).toEqual([
        { seriesId, ordinal: index + 1 },
      ]);
    }
  });

  test("serializes concurrent playlist appends into unique stable positions", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const create = (side: "left" | "right", key: string) =>
      authoring.createDraft({
        actor,
        idempotencyKey: key,
        metadata: {
          title: `${side} playlist append`,
          summary: "The Series row lock appends both Materials.",
          access: "free",
          topicId,
          formatId,
          tagIds: [],
          seriesIds: [secondSeriesId],
        },
        body: representativeDocument(),
      });

    const [left, right] = await Promise.all([
      create("left", "a0000000-0000-4000-8000-000000000025"),
      create("right", "a0000000-0000-4000-8000-000000000026"),
    ]);
    expect(left.ok).toBe(true);
    expect(right.ok).toBe(true);
    const memberships = await testDatabase.prisma.seriesMembership.findMany({
      where: { seriesId: secondSeriesId },
      orderBy: { ordinal: "asc" },
      select: { ordinal: true },
    });
    expect(memberships).toEqual([{ ordinal: 1 }, { ordinal: 2 }]);
  });

  test("allows exactly one of two concurrent Saves from the same content version", async () => {
    const { authoring } = assembleMaterials({
      prisma: testDatabase.prisma,
      authorPolicy: { canManage: () => true },
    });
    const metadata = {
      title: "Concurrent Save",
      summary: "The Material row lock selects one winner.",
      access: "free",
      topicId,
      formatId,
      tagIds: [],
      seriesIds: [],
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
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesIds: [],
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
        access: "free",
        topicId,
        formatId,
        tagIds: [],
        seriesIds: [],
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
