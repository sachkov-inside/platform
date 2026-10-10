import { describe, expect, test } from "vitest";
import {
  termUpdateConflict,
  publishedTerm,
} from "../../src/modules/materials/domain/term-definition.js";

const definition = {
  id: "44300000-0000-4000-8000-000000000001",
  title: "Деплой",
  aliases: [],
  definition: "Авторский текст",
  materialId: "44300000-0000-4000-8000-000000000101",
};

describe("shared term definitions", () => {
  test("source imports preserve a manual edit and reject a changed owner", () => {
    const current = { termVersion: 3, sourceId: "content:deploy" };
    expect(termUpdateConflict(current, 2, "content:deploy")).toBe(
      "term_version_conflict",
    );
    expect(termUpdateConflict(current, 3, "another:deploy")).toBe(
      "source_mismatch",
    );
    expect(
      termUpdateConflict(
        { termVersion: 3, sourceId: null },
        3,
        "content:deploy",
      ),
    ).toBe("source_mismatch");
    expect(termUpdateConflict(current, 3, null)).toBeUndefined();
    expect(termUpdateConflict(null, null, "content:deploy")).toBeUndefined();
  });

  test("public cards hide an unpublished definition and never copy the detailed Material body", () => {
    expect(publishedTerm(definition, 4, "unpublished", null)).toBeNull();
    const card = publishedTerm(definition, 4, "published", null);
    expect(card?.definition.materialId).toBeUndefined();
    expect(card?.detailedMaterial).toBeNull();
    const linked = publishedTerm(definition, 5, "published", {
      materialId: definition.materialId,
      slug: "first-deploy",
      publicationState: "published",
    });
    expect(linked?.detailedMaterial).toEqual({
      materialId: definition.materialId,
      href: "/materials/first-deploy",
    });
    expect(linked?.termVersion).toBe(5);
    expect(Object.keys(linked ?? {})).toEqual([
      "definition",
      "termVersion",
      "detailedMaterial",
    ]);
  });
});
