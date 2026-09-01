import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => {
  class SessionUnavailableError extends Error {}
  return {
    SessionUnavailableError,
    getOptionalAccessToken: vi.fn(),
    getRequiredAccessToken: vi.fn(),
    requestDelivery: vi.fn(),
    requestUpload: vi.fn(),
  };
});

vi.mock("@/shared/api/backend/index.server", () => ({
  requestMaterialAssetDelivery: fakes.requestDelivery,
  requestMaterialAssetUpload: fakes.requestUpload,
}));

vi.mock("@/shared/auth/index.server", () => ({
  getOptionalPlatformAccessToken: fakes.getOptionalAccessToken,
  getPlatformAccessToken: fakes.getRequiredAccessToken,
  isSameOriginMutation: (request: Request, baseUrl: string) =>
    request.headers.get("origin") === new URL(baseUrl).origin,
  LogtoSessionUnavailableError: fakes.SessionUnavailableError,
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));

import {
  proxyMaterialAssetDelivery,
  proxyMaterialAssetUpload,
} from "@/features/material-assets/api/material-assets-bff.server";

const materialId = "10000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000001";

describe("Material assets BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.getRequiredAccessToken.mockResolvedValue("access-token");
    fakes.getOptionalAccessToken.mockResolvedValue("optional-token");
  });

  it("rejects a cross-origin upload before identity or backend work", async () => {
    const response = await proxyMaterialAssetUpload(
      uploadRequest("https://attacker.example.test"),
      materialId,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fakes.getRequiredAccessToken).not.toHaveBeenCalled();
    expect(fakes.requestUpload).not.toHaveBeenCalled();
  });

  it("copies the backend upload contract and selected response headers", async () => {
    fakes.requestUpload.mockResolvedValue(new Response(
      JSON.stringify({ assetId, state: "ready" }),
      {
        status: 201,
        headers: {
          "cache-control": "private, no-store",
          "content-type": "application/json",
          "x-content-type-options": "nosniff",
        },
      },
    ));

    const response = await proxyMaterialAssetUpload(
      uploadRequest("https://inside.example.test"),
      materialId,
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(fakes.requestUpload).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "access-token",
      idempotencyKey: "upload-1",
      materialId,
    }));
  });

  it("distinguishes a missing session and a backend upload outage", async () => {
    fakes.getRequiredAccessToken.mockRejectedValueOnce(
      new fakes.SessionUnavailableError(),
    );
    const missingSession = await proxyMaterialAssetUpload(
      uploadRequest("https://inside.example.test"),
      materialId,
    );
    expect(missingSession.status).toBe(401);

    fakes.requestUpload.mockRejectedValueOnce(new Error("backend unavailable"));
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
    fakes.requestDelivery.mockResolvedValue(new Response(null, {
      status: 302,
      headers: {
        "cache-control": "private, no-store",
        location: "https://storage.example.test/signed",
      },
    }));
    const request = new Request(
      "https://inside.example.test/api/materials/m/assets/a?contentVersion=7&preview=true",
    );

    const response = await proxyMaterialAssetDelivery(request, { assetId, materialId });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://storage.example.test/signed");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fakes.requestDelivery).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "optional-token",
      assetId,
      contentVersion: 7,
      materialId,
      preview: true,
    }));
  });

  it("rejects malformed delivery queries and fails closed on identity outages", async () => {
    const malformed = await proxyMaterialAssetDelivery(
      new Request("https://inside.example.test/api/asset?contentVersion=7&preview=yes"),
      { assetId, materialId },
    );
    expect(malformed.status).toBe(404);
    expect(fakes.requestDelivery).not.toHaveBeenCalled();

    fakes.getOptionalAccessToken.mockRejectedValueOnce(new Error("identity unavailable"));
    const unavailable = await proxyMaterialAssetDelivery(
      new Request("https://inside.example.test/api/asset?contentVersion=7"),
      { assetId, materialId },
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("private, no-store");
  });
});

function uploadRequest(origin: string): Request {
  const form = new FormData();
  form.set("kind", "file");
  form.set("file", new Blob(["pdf"], { type: "application/pdf" }), "guide.pdf");
  return new Request("https://inside.example.test/api/authoring/materials/assets", {
    body: form,
    headers: { "idempotency-key": "upload-1", origin },
    method: "POST",
  });
}
