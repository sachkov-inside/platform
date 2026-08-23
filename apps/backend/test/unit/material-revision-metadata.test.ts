import { describe, expect, test } from "vitest";

import { MaterialRevisionMetadata } from "../../src/modules/materials/domain/material-revision-metadata.js";

const topicId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
const formatId = "93000000-0000-4000-8000-000000000002";
const firstTagId = "93000000-0000-4000-8000-000000000003";
const secondTagId = "93000000-0000-4000-8000-000000000004";
const firstSeriesId = "93000000-0000-4000-8000-000000000005";
const secondSeriesId = "93000000-0000-4000-8000-000000000006";

function validMetadata() {
  return {
    title: "  Material title  ",
    summary: "  Material summary  ",
    slug: "material-title",
    topicId,
    formatId,
    tagIds: [secondTagId, firstTagId],
    seriesMemberships: [
      { seriesId: secondSeriesId, ordinal: 2 },
      { seriesId: firstSeriesId, ordinal: 1 },
    ],
  };
}

describe("Material revision metadata rules", () => {
  test("bounds, normalizes and deterministically orders accepted metadata", () => {
    const result = MaterialRevisionMetadata.create(validMetadata());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.code);
    }
    expect(result.value.toValues()).toEqual({
      title: "Material title",
      summary: "Material summary",
      slug: "material-title",
      topicId: topicId.toLowerCase(),
      formatId,
      tagIds: [firstTagId, secondTagId],
      seriesMemberships: [
        { seriesId: firstSeriesId, ordinal: 1 },
        { seriesId: secondSeriesId, ordinal: 2 },
      ],
    });
  });

  test("returns stable errors for invalid scalars, duplicate Tags and duplicate Series", () => {
    expect(MaterialRevisionMetadata.create({ ...validMetadata(), title: "" })).toMatchObject({
      ok: false,
      error: { code: "invalid_content", issues: [{ code: "invalid_metadata", path: "/title" }] },
    });
    expect(
      MaterialRevisionMetadata.create({ ...validMetadata(), tagIds: [firstTagId, firstTagId] }),
    ).toEqual({ ok: false, error: { code: "duplicate_tag", tagId: firstTagId } });
    expect(
      MaterialRevisionMetadata.create({
        ...validMetadata(),
        seriesMemberships: [
          { seriesId: firstSeriesId, ordinal: 1 },
          { seriesId: firstSeriesId, ordinal: 2 },
        ],
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [{ code: "duplicate_series", path: "/seriesMemberships" }],
      },
    });
  });

  test("revises immutably and preserves a valid original value", () => {
    const created = MaterialRevisionMetadata.create(validMetadata());
    if (!created.ok) {
      throw new Error(created.error.code);
    }

    const revised = created.value.revise({ title: "Revised title" });
    expect(revised.ok).toBe(true);
    if (!revised.ok) {
      throw new Error(revised.error.code);
    }
    expect(created.value.title).toBe("Material title");
    expect(revised.value.title).toBe("Revised title");
    expect(Object.isFrozen(created.value)).toBe(true);
    expect(Object.isFrozen(created.value.tagIds)).toBe(true);
  });
});
