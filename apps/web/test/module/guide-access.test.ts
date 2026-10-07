import { afterEach, describe, expect, it, vi } from "vitest";

import { readViewerGuideSale } from "@/entities/subscription.sale.server";

function respondWithAccess(response: Response) {
  return vi.fn((request: Request) =>
    Promise.resolve(
      request.url.endsWith("/access")
        ? response
        : Response.json(
            request.url.includes("cohorts")
              ? { items: [] }
              : { items: [], nextCursor: null },
          ),
    ),
  );
}

const guideId = "72000000-0000-4000-8000-000000000831";

describe("Guide access server adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads the current Account's answer with its token", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetch = respondWithAccess(Response.json({ access: "open" }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      readViewerGuideSale(guideId, "member-token"),
    ).resolves.toMatchObject({ access: "open" });
    const request: unknown = fetch.mock.calls.find(([request]) =>
      request.url.endsWith("/access"),
    )?.[0];
    if (!(request instanceof Request)) throw new Error("No backend request");
    expect(request.url).toBe(
      `https://platform-api.example.test/accounts/current/guides/${guideId}/access`,
    );
    expect(request.headers.get("authorization")).toBe("Bearer member-token");
  });

  it.each([
    ["a failed read", Response.json({}, { status: 503 })],
    ["an answer outside the contract", Response.json({ access: "maybe" })],
  ])("has no answer after %s", async (_case, response) => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    vi.stubGlobal("fetch", respondWithAccess(response));

    await expect(
      readViewerGuideSale(guideId, "member-token"),
    ).resolves.toMatchObject({ access: "unknown" });
  });
});
