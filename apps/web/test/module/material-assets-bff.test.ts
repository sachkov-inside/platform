import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "@/shared/auth/index.server";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  proxyMaterialAssetDelivery as realDelivery,
  proxyMaterialAssetUpload as realUpload,
} from "@/features/material-assets/api/material-assets-bff.server";

const proxyMaterialAssetUpload = (...args: Parameters<typeof realUpload>) =>
  session(() => realUpload(...args));
const proxyMaterialAssetDelivery = (...args: Parameters<typeof realDelivery>) =>
  session(() => {
    if (session.cookieHeader !== null)
      args[0].headers.set("cookie", session.cookieHeader);
    return realDelivery(...args);
  });

const materialId = "10000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000001";

describe("Material assets BFF", () => {
  beforeEach(async () => {
    backend.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
    session = await realBffSession();
    interceptBackendHttp(backend);
  });
  afterEach(() => vi.useRealTimers());

  it("rejects a cross-origin upload before identity or backend work", async () => {
    const tokenReads = vi.spyOn(auth, "getPlatformAccessToken");
    const response = await proxyMaterialAssetUpload(
      uploadRequest("https://attacker.example.test"),
      materialId,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(tokenReads).not.toHaveBeenCalled();
    expect(backend).not.toHaveBeenCalled();
  });

  it("copies the backend upload contract and selected response headers", async () => {
    backend.mockResolvedValue(
      new Response(JSON.stringify({ assetId, state: "ready" }), {
        status: 201,
        headers: {
          "cache-control": "private, no-store",
          "content-type": "application/json",
          "x-content-type-options": "nosniff",
        },
      }),
    );

    const response = await proxyMaterialAssetUpload(
      uploadRequest("https://inside.example.test"),
      materialId,
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const outgoing = expectSingleBackendRequest(
      backend,
      "POST",
      `/authoring/materials/${materialId}/assets`,
    );
    expect(outgoing.headers.get("idempotency-key")).toBe("upload-1");
    const form = await outgoing.formData();
    expect(form.get("kind")).toBe("file");
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    if (!(file instanceof File)) throw new Error("Expected uploaded File");
    expect(file.name).toBe("product.pdf");
    expect(file.type).toBe("application/pdf");
    expect(await file.text()).toBe("pdf");
  });

  it("distinguishes a missing session and a backend upload outage", async () => {
    session = await realBffSession(null);
    const missingSession = await proxyMaterialAssetUpload(
      uploadRequest("https://inside.example.test"),
      materialId,
    );
    expect(missingSession.status).toBe(401);

    expect(backend).not.toHaveBeenCalled();
    session = await realBffSession();
    backend.mockRejectedValueOnce(new Error("backend unavailable"));
    const unavailable = await proxyMaterialAssetUpload(
      uploadRequest("https://inside.example.test"),
      materialId,
    );
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      code: "dependency_unavailable",
    });
  });

  it("forwards the version-bound delivery and preserves redirect cache headers", async () => {
    backend.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          "cache-control": "private, no-store",
          location: "https://storage.example.test/signed",
        },
      }),
    );
    const request = new Request(
      "https://inside.example.test/api/materials/m/assets/a?contentVersion=7&preview=true",
    );

    const response = await proxyMaterialAssetDelivery(request, {
      assetId,
      materialId,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://storage.example.test/signed",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const outgoing = expectSingleBackendRequest(
      backend,
      "GET",
      `/materials/${materialId}/assets/${assetId}?contentVersion=7&preview=true`,
    );
    expect(outgoing.redirect).toBe("manual");
  });

  it("keeps the API's type and inert-content headers on public SVG bytes (#2025)", async () => {
    session = await realBffSession(null);
    const policy = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    backend.mockResolvedValue(
      new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
        status: 200,
        headers: {
          "cache-control": "public, max-age=31536000, immutable",
          "content-security-policy": policy,
          "content-type": "image/svg+xml",
          "x-content-type-options": "nosniff",
        },
      }),
    );

    const response = await proxyMaterialAssetDelivery(
      new Request(
        "https://inside.example.test/api/materials/m/assets/a/images/720?contentVersion=7",
      ),
      { assetId, materialId, variantWidth: "720" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(policy);
    const outgoing = expectSingleBackendRequest(
      backend,
      "GET",
      `/materials/${materialId}/assets/${assetId}/images/720?contentVersion=7`,
      null,
    );
    expect(outgoing.redirect).toBe("manual");
    expect(await response.text()).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
  });

  it("passes Caddy's edge mark to the API and returns its internal answer (#1766)", async () => {
    backend.mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: {
          "cache-control": "private, no-store",
          "x-inside-storage-cache-control":
            "private, max-age=31536000, immutable",
          "x-inside-storage-location":
            "https://inside-production-protected.storage.yandexcloud.net/k?X-Amz-Signature=s",
        },
      }),
    );
    const url =
      "https://sachkov.dev/api/materials/m/assets/a/images/960?contentVersion=7";

    const edge = await proxyMaterialAssetDelivery(
      new Request(url, { headers: { "x-inside-storage-delivery": "edge" } }),
      { assetId, materialId, variantWidth: "960" },
    );
    expect(edge.status).toBe(204);
    expect(edge.headers.get("x-inside-storage-location")).toContain(
      "X-Amz-Signature",
    );
    const edgeRequest = expectSingleBackendRequest(
      backend,
      "GET",
      `/materials/${materialId}/assets/${assetId}/images/960?contentVersion=7`,
    );
    expect(edgeRequest.headers.get("x-inside-storage-delivery")).toBe("edge");

    await proxyMaterialAssetDelivery(new Request(url), {
      assetId,
      materialId,
    });
    expect(backend).toHaveBeenCalledTimes(2);
    const direct = backend.mock.lastCall?.[0];
    expect(direct?.url).toBe(
      `https://platform-api.example.test/materials/${materialId}/assets/${assetId}?contentVersion=7`,
    );
    expect(direct?.headers.get("x-inside-storage-delivery")).toBeNull();
  });

  it("rejects malformed delivery queries and fails closed on identity outages", async () => {
    const malformed = await proxyMaterialAssetDelivery(
      new Request(
        "https://inside.example.test/api/asset?contentVersion=7&preview=yes",
      ),
      { assetId, materialId },
    );
    expect(malformed.status).toBe(404);
    expect(backend).not.toHaveBeenCalled();

    session = await realBffSession({ refreshToken: "unavailable-identity" });
    const externalRequests = vi.spyOn(globalThis, "fetch");
    const unavailable = await proxyMaterialAssetDelivery(
      new Request("https://inside.example.test/api/asset?contentVersion=7"),
      { assetId, materialId },
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("private, no-store");
    expect(backend).not.toHaveBeenCalled();
    expect(
      externalRequests.mock.calls.some(
        ([input, init]) =>
          new URL(new Request(input, init).url).origin ===
          "https://identity.example.test",
      ),
    ).toBe(true);
  });
});

function uploadRequest(origin: string): Request {
  const form = new FormData();
  form.set("kind", "file");
  form.set(
    "file",
    new Blob(["pdf"], { type: "application/pdf" }),
    "product.pdf",
  );
  return new Request(
    "https://inside.example.test/api/authoring/materials/assets",
    {
      body: form,
      headers: { "idempotency-key": "upload-1", origin },
      method: "POST",
    },
  );
}
