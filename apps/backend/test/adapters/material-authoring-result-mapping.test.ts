import { describe, expect, test } from "vitest";

import { statusForMaterialAuthoringError } from "../../src/modules/materials/adapters/nest/material-authoring-http.js";

describe("material authoring transport mapping", () => {
  test("maps stable application codes without owning authoring rules", () => {
    expect(
      statusForMaterialAuthoringError({
        code: "stale_content_version",
        currentContentVersion: 7,
      }),
    ).toBe(409);
    expect(
      statusForMaterialAuthoringError({
        code: "invalid_content",
        issues: [{ code: "unsafe_link", path: "/doc/content/0" }],
      }),
    ).toBe(422);
    expect(statusForMaterialAuthoringError({ code: "forbidden" })).toBe(403);
    expect(
      statusForMaterialAuthoringError({
        code: "dependency_unavailable",
        retryable: true,
      }),
    ).toBe(503);
  });
});
