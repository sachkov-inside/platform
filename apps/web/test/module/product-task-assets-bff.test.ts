import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "@/shared/auth/index.server";
import { realBffSession } from "../support/real-bff-session";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let scope: Awaited<ReturnType<typeof realBffSession>>;
import { proxyProductTaskAssetDelivery as realProxyProductTaskAssetDelivery } from "@/_pages/product-task/api/task-assets-bff.server";

const proxyProductTaskAssetDelivery = (
  ...args: Parameters<typeof realProxyProductTaskAssetDelivery>
) =>
  scope(() => {
    if (scope.cookieHeader !== null)
      args[0].headers.set("cookie", scope.cookieHeader);
    return realProxyProductTaskAssetDelivery(...args);
  });
beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  scope = await realBffSession("viewer-token");
  interceptBackendHttp(backend);
});
afterEach(() => vi.useRealTimers());

describe("Task asset delivery BFF (#1194)", () => {
  it("forwards the viewer token and preserves the authorized redirect without caching", async () => {
    backend.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: "https://assets.example.test/signed",
          "cache-control": "private, no-store",
        },
      }),
    );
    const response = await proxyProductTaskAssetDelivery(
      new Request(
        "https://inside.example.test/api/products/course/tasks/task/assets/asset",
      ),
      { productSlug: "course", code: "task", assetId: "asset" },
    );
    const outgoing = expectSingleBackendRequest(
      backend,
      "GET",
      "/library/products/course/tasks/task/assets/asset",
      "viewer-token",
    );
    expect(outgoing.redirect).toBe("manual");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://assets.example.test/signed",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps a refused Task asset delivery refused", async () => {
    scope = await realBffSession(null);
    backend.mockResolvedValue(
      new Response(JSON.stringify({ code: "asset_not_found" }), {
        status: 404,
      }),
    );
    const response = await proxyProductTaskAssetDelivery(
      new Request(
        "https://inside.example.test/api/products/course/tasks/task/assets/asset",
      ),
      { productSlug: "course", code: "task", assetId: "asset" },
    );
    expect(response.status).toBe(404);
    expectSingleBackendRequest(
      backend,
      "GET",
      "/library/products/course/tasks/task/assets/asset",
      null,
    );
    expect(await response.json()).toEqual({ code: "asset_not_found" });
  });
  it("forwards an image width without changing the viewer or private redirect", async () => {
    backend.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: "https://assets.example.test/480",
          "cache-control": "private, no-store",
        },
      }),
    );
    const response = await proxyProductTaskAssetDelivery(
      new Request(
        "https://inside.example.test/api/products/course/tasks/task/assets/asset?width=480",
      ),
      { productSlug: "course", code: "task", assetId: "asset" },
    );
    expect(
      expectSingleBackendRequest(
        backend,
        "GET",
        "/library/products/course/tasks/task/assets/asset?width=480",
        "viewer-token",
      ).redirect,
    ).toBe("manual");
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(["0", "-1", "NaN", "1.5", "10000", "", "480x", "0x1e0"])(
    "rejects malformed width %s before session/backend work",
    async (width) => {
      const tokenReads = vi.spyOn(auth, "getOptionalPlatformAccessToken");
      const response = await proxyProductTaskAssetDelivery(
        new Request(
          `https://inside.example.test/api/products/course/tasks/task/assets/asset?width=${width}`,
        ),
        { productSlug: "course", code: "task", assetId: "asset" },
      );
      expect(response.status).toBe(404);
      expect(tokenReads).not.toHaveBeenCalled();
      expect(backend).not.toHaveBeenCalled();
    },
  );
});
