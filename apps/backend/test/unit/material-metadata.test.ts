import { describe, expect, test } from "vitest";

import { MaterialMetadata } from "../../src/modules/materials/domain/material-metadata.js";

describe("MaterialMetadata", () => {
  test("accepts Workshop as a distinct protected access class", () => {
    const result = MaterialMetadata.create({
      title: "Synthetic Workshop hint",
      summary: "Only a revealed Workshop hint may deliver this body.",
      slug: "synthetic-workshop-hint",
      access: "workshop",
      topicId: "72000000-0000-4000-8000-000000000002",
      formatId: "72000000-0000-4000-8000-000000000003",
      tagIds: [],
      seriesMemberships: [],
    });

    expect(result).toMatchObject({ ok: true });
  });

  test("accepts a structurally valid incomplete draft and reports publish-required fields", () => {
    const result = MaterialMetadata.create({
      title: null,
      summary: null,
      slug: null,
      access: "free",
      topicId: null,
      formatId: null,
      tagIds: [],
      seriesMemberships: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected incomplete draft metadata to be structurally valid");
    }
    expect(result.value.validateForPublication()).toEqual({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [
          { code: "required_for_publication", path: "/metadata/formatId" },
          { code: "required_for_publication", path: "/metadata/slug" },
          { code: "required_for_publication", path: "/metadata/summary" },
          { code: "required_for_publication", path: "/metadata/title" },
          { code: "required_for_publication", path: "/metadata/topicId" },
        ],
      },
    });
  });
});
