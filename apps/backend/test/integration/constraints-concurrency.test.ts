import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createContentAuthoring } from "../../src/modules/content-authoring/index.js";
import { createContentSchema } from "../../src/modules/content-schema/index.js";
import { representativeDocument } from "../fixtures/content-schema/representative.js";
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

describe("content authoring integrity contract", () => {
  let testDatabase: TestDatabase;

  beforeAll(async () => {
    testDatabase = await createMigratedTestDatabase();
    await testDatabase.database
      .insertInto("topics")
      .values({ id: topicId, slug: "product", name: "Product" })
      .execute();
    await testDatabase.database
      .insertInto("formats")
      .values({ id: formatId, slug: "text", name: "Text" })
      .execute();
    await testDatabase.database
      .insertInto("tags")
      .values({ id: tagId, name: "Platform", normalized_name: "platform" })
      .execute();
    await testDatabase.database
      .insertInto("series")
      .values([
        { id: seriesId, slug: "build", name: "Build" },
        { id: secondSeriesId, slug: "operate", name: "Operate" },
      ])
      .execute();
  });

  afterAll(async () => {
    await testDatabase.dispose();
  });

  test("rolls back invalid references including the idempotency claim", async () => {
    const authoring = createContentAuthoring({
      database: testDatabase.database,
      contentSchema: createContentSchema(),
      authorPolicy: { canAuthor: () => true },
    });
    const idempotencyKey = "a0000000-0000-4000-8000-000000000010";
    const base = {
      actor,
      idempotencyKey,
      metadata: {
        title: "Reference validation",
        summary: "Required references are checked once.",
        slug: "reference-validation",
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

    const corrected = await authoring.createDraft({
      ...base,
      metadata: { ...base.metadata, topicId },
    });
    expect(corrected.ok).toBe(true);
  });

  test("maps unique slug, duplicate Tag and occupied Series ordinal consistently", async () => {
    const authoring = createContentAuthoring({
      database: testDatabase.database,
      contentSchema: createContentSchema(),
      authorPolicy: { canAuthor: () => true },
    });
    const metadata = {
      title: "Constraint owner",
      summary: "Database arbitrates races.",
      slug: "constraint-owner",
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

  test("keeps persisted MaterialRevision snapshots immutable", async () => {
    const authoring = createContentAuthoring({
      database: testDatabase.database,
      contentSchema: createContentSchema(),
      authorPolicy: { canAuthor: () => true },
    });
    const created = await authoring.createDraft({
      actor,
      idempotencyKey: "a0000000-0000-4000-8000-000000000030",
      metadata: {
        title: "Immutable revision",
        summary: "History is append-only.",
        slug: "immutable-revision",
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

    await expect(
      testDatabase.database
        .updateTable("material_revisions")
        .set({ title: "Mutated" })
        .where("id", "=", created.value.revisionId)
        .execute(),
    ).rejects.toMatchObject({ code: "55000" });
    expect(
      await authoring.loadDraft({ actor, materialId: created.value.materialId }),
    ).toEqual({ ok: true, value: created.value.draft });
  });
});
