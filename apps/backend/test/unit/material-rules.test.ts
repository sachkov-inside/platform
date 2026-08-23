import { describe, expect, test } from "vitest";

import { validateMetadata } from "../../src/modules/content-authoring/internal/shared/material-rules.js";

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

describe("Material metadata rules", () => {
  test("bounds, normalizes and deterministically orders accepted metadata", () => {
    expect(validateMetadata(validMetadata())).toEqual({
      ok: true,
      value: {
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
      },
    });
  });

  test("returns stable errors for invalid scalars, duplicate Tags and duplicate Series", () => {
    expect(validateMetadata({ ...validMetadata(), title: "" })).toMatchObject({
      ok: false,
      error: { code: "invalid_content", issues: [{ code: "invalid_metadata", path: "/title" }] },
    });
    expect(
      validateMetadata({ ...validMetadata(), tagIds: [firstTagId, firstTagId] }),
    ).toEqual({ ok: false, error: { code: "duplicate_tag", tagId: firstTagId } });
    expect(
      validateMetadata({
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
});
