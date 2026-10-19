import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ token: vi.fn(), deliver: vi.fn() }));
vi.mock("@/shared/auth/index.server", () => ({
  getOptionalPlatformAccessToken: fakes.token,
}));
vi.mock("@/shared/api/backend/index.server", async () => {
  const responses =
    await import("@/shared/api/backend/backend-proxy-response.server");
  return { ...responses, requestProductTaskAssetDelivery: fakes.deliver };
});

import { proxyProductTaskAssetDelivery } from "@/_pages/product-task/api/task-assets-bff.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Task asset delivery BFF (#1194)", () => {
  it("forwards the viewer token and preserves the authorized redirect without caching", async () => {
    fakes.token.mockResolvedValue("viewer-token");
    fakes.deliver.mockResolvedValue(
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
    expect(fakes.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "viewer-token",
        productSlug: "course",
        code: "task",
        assetId: "asset",
      }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://assets.example.test/signed",
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps a refused Task asset delivery refused", async () => {
    fakes.token.mockResolvedValue(undefined);
    fakes.deliver.mockResolvedValue(
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
    expect(await response.json()).toEqual({ code: "asset_not_found" });
  });
  it("forwards an image width without changing the viewer or private redirect", async () => {
    fakes.token.mockResolvedValue("viewer-token");
    fakes.deliver.mockResolvedValue(
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
    expect(fakes.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        variantWidth: 480,
        accessToken: "viewer-token",
      }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(["0", "-1", "NaN", "1.5", "10000", "", "480x", "0x1e0"])(
    "rejects malformed width %s before session/backend work",
    async (width) => {
      const response = await proxyProductTaskAssetDelivery(
        new Request(
          `https://inside.example.test/api/products/course/tasks/task/assets/asset?width=${width}`,
        ),
        { productSlug: "course", code: "task", assetId: "asset" },
      );
      expect(response.status).toBe(404);
      expect(fakes.token).not.toHaveBeenCalled();
      expect(fakes.deliver).not.toHaveBeenCalled();
    },
  );
});
