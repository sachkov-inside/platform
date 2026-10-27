import { expect, test } from "vitest";
import { materialMetadataSelectionWireSchema } from "../../src/modules/materials/adapters/material-authoring-wire.js";
import { authoringSourceSchema } from "../../src/infrastructure/content-authoring/authoring-source.js";

test("current Material writes name Product membership and reject the retired Series field", () => {
  const fields = {
    title: null,
    summary: null,
    access: "free",
    difficulty: null,
    outcomes: [],
    topicId: null,
    formatId: null,
    tagIds: [],
  };
  expect(
    materialMetadataSelectionWireSchema.safeParse({ ...fields, productIds: [] })
      .success,
  ).toBe(true);
  expect(
    materialMetadataSelectionWireSchema.safeParse({ ...fields, seriesIds: [] })
      .success,
  ).toBe(false);
});

test("current versioned source writes retire the inert feed toggle", () => {
  const source = {
    version: 2,
    id: "opaque:source",
    path: "lesson.md",
    revision: "a".repeat(64),
  };
  expect(authoringSourceSchema.safeParse(source).success).toBe(true);
  expect(
    authoringSourceSchema.safeParse({ ...source, showInFeed: false }).success,
  ).toBe(false);
});
