import { HttpException } from "@nestjs/common";
import { describe, expect, test } from "vitest";

import { throwContentLibraryError } from "../../src/entrypoints/api/content-library.controller.js";

describe("ContentLibrary REST result mapping", () => {
  test("maps an internal result to opaque RFC 9457 Problem Details", () => {
    expect.assertions(3);

    try {
      throwContentLibraryError({
        code: "internal_error",
        correlationId: "72000000-0000-4000-8000-000000000090",
      });
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(HttpException);
      if (!(error instanceof HttpException)) {
        return;
      }
      expect(error.getStatus()).toBe(500);
      expect(error.getResponse()).toEqual({
        type: "urn:inside:problem:internal-error",
        title: "Internal error",
        status: 500,
        code: "internal_error",
        correlationId: "72000000-0000-4000-8000-000000000090",
      });
    }
  });
});
