import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  cookies: vi.fn(),
  getAccessToken: vi.fn(),
  getAccessTokenRSC: vi.fn(),
}));

vi.mock("@logto/next/server-actions", () => ({
  getAccessToken: fakes.getAccessToken,
  getAccessTokenRSC: fakes.getAccessTokenRSC,
}));

vi.mock("next/headers", () => ({ cookies: fakes.cookies }));

import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";

describe("optional Platform access token", () => {
  beforeEach(() => {
    fakes.getAccessToken.mockReset();
    fakes.getAccessTokenRSC.mockReset();
    fakes.cookies.mockResolvedValue({
      get: vi.fn(() => ({ value: "unfinished-logto-session" })),
      getAll: vi.fn(() => [{ name: "logto_inside-web-local" }]),
    });
  });

  it("treats an unfinished Logto cookie as a guest session", async () => {
    fakes.getAccessTokenRSC.mockRejectedValue(
      Object.assign(new Error("Not authenticated."), {
        code: "not_authenticated",
        name: "LogtoClientError",
      }),
    );

    await expect(getOptionalPlatformAccessToken()).resolves.toBeUndefined();
  });

  it("keeps provider failures visible", async () => {
    const providerFailure = new Error("Logto dependency unavailable");
    fakes.getAccessTokenRSC.mockRejectedValue(providerFailure);

    await expect(getOptionalPlatformAccessToken()).rejects.toBe(providerFailure);
  });
});
