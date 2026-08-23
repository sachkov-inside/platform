import { describe, expect, test } from "vitest";

import { materialId } from "../../src/modules/materials/domain/material-identifiers.js";
import {
  isUuid,
  normalizedUuidSchema,
} from "../../src/modules/materials/domain/uuid.js";

describe("Materials UUID policy", () => {
  test("accepts RFC UUIDs and canonicalizes their case", () => {
    const uppercase = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";

    expect(normalizedUuidSchema.parse(uppercase)).toBe(uppercase.toLowerCase());
    expect(materialId(uppercase)).toBe(uppercase.toLowerCase());
    expect(isUuid("01890f3d-5b7a-7cc8-98c4-dc0c0c07398f")).toBe(true);
  });

  test("rejects UUID-like strings outside the shared policy", () => {
    expect(isUuid("aaaaaaaa-aaaa-4aaa-caaa-aaaaaaaaaaaa")).toBe(false);
    expect(() => materialId("not-a-uuid")).toThrow(
      new TypeError("MaterialId must be a UUID"),
    );
  });
});
