import { afterEach, describe, expect, it, vi } from "vitest";

import {
  copyBackendResponse,
  isStorageEdgeRequest,
  requestMaterialAssetDelivery,
  requestOwnProfileAvatarDelivery,
  requestProductTaskAssetDelivery,
  requestReaderProductArtifactFile,
} from "@/shared/api/backend/index.server";

const signedAddress =
  "https://inside-production-protected.storage.yandexcloud.net/materials/a/image-960.webp?X-Amz-Signature=s";

/**
 * Caddy marks protected-delivery requests (#1766). The BFF forwards only that mark to the API and
 * copies the API's internal answer back for Caddy; without the mark nothing changes.
 */
describe("Protected delivery through the site edge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("recognises only the exact mark Caddy sets", () => {
    const request = (value?: string) =>
      new Request(
        "https://sachkov.dev/api/materials/m/assets/a?contentVersion=1",
        value === undefined
          ? {}
          : { headers: { "x-inside-storage-delivery": value } },
      );
    expect(isStorageEdgeRequest(request("edge"))).toBe(true);
    expect(isStorageEdgeRequest(request())).toBe(false);
    expect(isStorageEdgeRequest(request("redirect"))).toBe(false);
  });

  it("forwards the mark from every delivery transport only when Caddy set it", async () => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    for (const viaStorageEdge of [true, false]) {
      fetchMock.mockClear();
      await requestMaterialAssetDelivery({
        accessToken: "reader-token",
        assetId: "a",
        contentVersion: 3,
        materialId: "m",
        preview: false,
        signal,
        viaStorageEdge,
      });
      await requestReaderProductArtifactFile({
        artifactId: "r",
        preview: false,
        productId: "p",
        signal,
        version: 2,
        viaStorageEdge,
      });
      await requestProductTaskAssetDelivery({
        assetId: "a",
        code: "t",
        productSlug: "p",
        signal,
        viaStorageEdge,
      });
      await requestOwnProfileAvatarDelivery({
        accessToken: "owner-token",
        avatarId: "v",
        signal,
        size: "160",
        viaStorageEdge,
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      for (const [, init] of fetchMock.mock.calls) {
        const headers = new Headers(init?.headers);
        expect(headers.get("x-inside-storage-delivery")).toBe(
          viaStorageEdge ? "edge" : null,
        );
        expect(init?.redirect).toBe("manual");
      }
      expect(
        new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization"),
      ).toBe("Bearer reader-token");
    }
  });

  it("copies the API's edge answer for Caddy unchanged", () => {
    const copied = copyBackendResponse(
      new Response(null, {
        status: 204,
        headers: {
          "cache-control": "private, no-store",
          "set-cookie": "api=1",
          "x-content-type-options": "nosniff",
          "x-inside-storage-cache-control":
            "private, max-age=31536000, immutable",
          "x-inside-storage-location": signedAddress,
        },
      }),
    );

    expect(copied.status).toBe(204);
    expect(copied.headers.get("x-inside-storage-location")).toBe(signedAddress);
    expect(copied.headers.get("x-inside-storage-cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(copied.headers.get("cache-control")).toBe("private, no-store");
    expect(copied.headers.get("set-cookie")).toBeNull();
  });
});
