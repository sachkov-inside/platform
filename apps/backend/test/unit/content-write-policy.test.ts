import { describe, expect, test } from "vitest";
import { checkContentWrite } from "../../src/modules/materials/domain/content-write-policy.js";

// #1051 acceptance seam: the Materials policy interface, with explicit expected matrix rows.
describe("content write ownership", () => {
  const targets = ["material", "product", "cover", "artifact"] as const;
  for (const kind of targets) {
    test.each([
      ["editor", null, null, null],
      ["mcp", null, null, null],
      ["editor", null, "inside-content:a", "forbidden"],
      ["mcp", null, "inside-content:a", "forbidden"],
      ["import", "inside-content:a", "inside-content:a", null],
      ["import", "inside-content:b", "inside-content:a", "forbidden"],
      ["import", "inside-content:a", null, "forbidden"],
    ] as const)(
      `${kind}: %s with writer %s and owner %s`,
      (via, sourceId, owner, expected) => {
        expect(
          checkContentWrite({ via, sourceId }, [
            { kind, sourceId: owner, path: "/id" },
          ])?.code ?? null,
        ).toBe(expected);
      },
    );
  }
  test.each([
    ["editor", null, null],
    ["mcp", null, null],
    ["editor", "inside-content:a", null],
    ["mcp", "inside-content:a", null],
    ["import", null, "forbidden"],
    ["import", "inside-content:a", "forbidden"],
  ] as const)("archive: %s with owner %s", (via, owner, expected) => {
    expect(
      checkContentWrite(
        { via, sourceId: via === "import" ? "inside-content:a" : null },
        [{ kind: "archive", sourceId: owner, path: "/id" }],
      )?.code ?? null,
    ).toBe(expected);
  });
  test.each([
    ["editor", null, null, null],
    ["mcp", null, null, null],
    ["editor", null, "inside-content:a", "invalid_reference"],
    ["mcp", null, "inside-content:a", "invalid_reference"],
    ["import", "inside-content:a", "inside-content:b", null],
    ["import", "inside-content:a", null, "invalid_reference"],
  ] as const)(
    "membership: %s with writer %s and member %s",
    (via, sourceId, owner, expected) => {
      const result = checkContentWrite({ via, sourceId }, [
        { kind: "membership", sourceId: owner, path: "/seriesIds/0" },
      ]);
      expect(result?.code ?? null).toBe(expected);
      if (expected === "invalid_reference")
        expect(result).toEqual({
          code: "invalid_reference",
          issues: [{ code: "material_source_mismatch", path: "/seriesIds/0" }],
        });
    },
  );
});
