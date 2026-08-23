import { describe, expect, test } from "vitest";

import { statusForContentAuthoringError } from "../../src/entrypoints/api/content-authoring-result-mapping.js";

describe("content authoring transport mapping", () => {
  test("maps stable application codes without owning authoring rules", () => {
    expect(
      statusForContentAuthoringError({
        code: "stale_revision",
        currentRevisionId: "10000000-0000-4000-8000-000000000001",
      }),
    ).toBe(409);
    expect(
      statusForContentAuthoringError({
        code: "invalid_content",
        issues: [{ code: "unsafe_link", path: "/doc/content/0" }],
      }),
    ).toBe(422);
    expect(statusForContentAuthoringError({ code: "forbidden" })).toBe(403);
    expect(
      statusForContentAuthoringError({
        code: "dependency_unavailable",
        retryable: true,
      }),
    ).toBe(503);
  });
});
