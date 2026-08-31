import { describe, expect, test } from "vitest";

import {
  localProofDatabaseUrl,
  loopbackHttpUrl,
} from "../../scripts/conformance-safety.js";

describe("conformance harness safety", () => {
  test("accepts only direct loopback proof databases", () => {
    const safe = "postgresql://inside:inside@127.0.0.1:5432/issue52_proof";

    expect(localProofDatabaseUrl(safe, "DATABASE_URL")).toBe(safe);
    expect(() =>
      localProofDatabaseUrl(
        `${safe}?host=production-db.example&port=5432`,
        "DATABASE_URL",
      ),
    ).toThrow(/without routing parameters/u);
    expect(() =>
      localProofDatabaseUrl(
        "postgresql://inside:inside@production-db.example/issue52_proof",
        "DATABASE_URL",
      ),
    ).toThrow(/direct loopback/u);
    expect(() =>
      localProofDatabaseUrl(
        "postgresql://inside:inside@127.0.0.1/ordinary_database",
        "DATABASE_URL",
      ),
    ).toThrow(/proof database/u);
  });

  test("accepts only direct loopback HTTP endpoints", () => {
    const safe = "http://127.0.0.1:44102";

    expect(loopbackHttpUrl(safe, "ENDPOINT")).toBe(safe);
    expect(() =>
      loopbackHttpUrl("https://telegram.example", "ENDPOINT"),
    ).toThrow(/direct loopback/u);
  });
});
