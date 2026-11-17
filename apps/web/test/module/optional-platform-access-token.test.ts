import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";
import { realBffSession } from "../support/real-bff-session";

const unexpectedRequests: string[] = [];
beforeEach(() => {
  vi.setSystemTime(new Date("2026-11-16T12:00:00.000Z"));
});
afterEach(() => {
  try {
    expect(unexpectedRequests).toEqual([]);
  } finally {
    unexpectedRequests.length = 0;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

describe("optional Platform access token", () => {
  it("reads the cached token through the real provider session", async () => {
    const scope = await realBffSession();
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      unexpectedRequests.push(request.url);
      return Promise.reject(
        new Error(`Unexpected external request ${request.url}`),
      );
    });
    await expect(scope(() => getOptionalPlatformAccessToken())).resolves.toBe(
      "trusted-token",
    );
  });

  it("treats an unfinished Logto cookie as a guest session", async () => {
    const scope = await realBffSession({ refreshToken: "" });
    const requests: Request[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      unexpectedRequests.push(request.url);
      return Promise.reject(
        new Error(`Unexpected external request ${request.url}`),
      );
    });
    await expect(
      scope(() => getOptionalPlatformAccessToken()),
    ).resolves.toBeUndefined();
    expect(requests).toEqual([]);
  });

  it("keeps provider failures visible", async () => {
    const scope = await realBffSession({
      refreshToken: "optional-provider-outage",
    });
    const providerFailure = new Error("Logto dependency unavailable");
    const requests: Request[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request);
      if (
        request.url !==
          "https://identity.example.test/oidc/.well-known/openid-configuration" ||
        request.method !== "GET"
      ) {
        unexpectedRequests.push(`${request.method} ${request.url}`);
      }
      return Promise.reject(providerFailure);
    });
    await expect(scope(() => getOptionalPlatformAccessToken())).rejects.toBe(
      providerFailure,
    );
    expect(requests).toHaveLength(1);
  });
});
