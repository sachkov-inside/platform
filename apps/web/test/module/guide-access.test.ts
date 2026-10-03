import { afterEach, describe, expect, it, vi } from "vitest";

import { loadGuideAccess } from "@/features/library-discovery.server";

const guideId = "72000000-0000-4000-8000-000000000831";

describe("Guide access server adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads the current Account's answer with its token", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetch = vi.fn().mockResolvedValue(Response.json({ access: "open" }));
    vi.stubGlobal("fetch", fetch);

    await expect(loadGuideAccess(guideId, "member-token")).resolves.toBe(
      "open",
    );
    const request: unknown = fetch.mock.calls[0]?.[0];
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(loadGuideAccess(guideId, "member-token")).resolves.toBe(
      "unknown",
    );
  });
});
