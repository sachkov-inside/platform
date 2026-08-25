import { describe, expect, test } from "vitest";

import { mapContentLibraryPersistenceError } from "../../src/modules/content-library/map-content-library-persistence-error.js";

describe("ContentLibrary persistence error mapping", () => {
  test("keeps retryable connection failures distinct from internal contract failures", () => {
    expect(mapContentLibraryPersistenceError({ code: "ECONNREFUSED" })).toEqual({
      code: "dependency_unavailable",
      retryable: true,
    });

    const internal = mapContentLibraryPersistenceError(
      new TypeError("Published Material access is outside the application contract"),
    );
    expect(internal.code).toBe("internal_error");
    if (internal.code === "internal_error") {
      expect(internal.correlationId).toMatch(/^[0-9a-f-]{36}$/u);
    }
  });
});
