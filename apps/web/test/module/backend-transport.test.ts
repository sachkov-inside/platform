import { afterEach, describe, expect, it, vi } from "vitest";

import { requestPublishedMaterial } from "@/shared/api/backend/index.server";

describe("generated backend transport", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("serializes generated path parameters and preserves Problem Details", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test/internal/");
    const problem = {
      type: "urn:inside:problem:material-not-found",
      title: "Material not found",
      status: 404,
      code: "material_not_found",
    };
    const fetchMock = vi.fn((request: Request) => {
      expect(request).toBeInstanceOf(Request);
      expect(request.url).toBe(
        "https://platform-api.example.test/internal/materials/missing%2Fmaterial",
      );
      expect(request.cache).toBe("no-store");
      return Promise.resolve(
        Response.json(problem, {
          status: 404,
          headers: { "Content-Type": "application/problem+json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestPublishedMaterial("missing/material");

    expect(result).toMatchObject({
      ok: false,
      problem,
      response: { status: 404 },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
