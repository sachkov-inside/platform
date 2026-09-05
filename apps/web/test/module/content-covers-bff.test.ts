import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as BackendModule from "@/shared/api/backend/index.server";

const fakes = vi.hoisted(() => {
  class SessionUnavailableError extends Error {}
  return {
    getAccessToken: vi.fn(),
    requestDelivery: vi.fn(),
    requestRemoval: vi.fn(),
    requestUpload: vi.fn(),
    SessionUnavailableError,
  };
});

vi.mock("@/shared/api/backend/index.server", async (importOriginal) => {
  const original = await importOriginal<typeof BackendModule>();
  return {
    ...original,
    requestContentCoverDelivery: fakes.requestDelivery,
    requestContentCoverRemoval: fakes.requestRemoval,
    requestContentCoverUpload: fakes.requestUpload,
  };
});

vi.mock("@/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: fakes.getAccessToken,
  LogtoSessionUnavailableError: fakes.SessionUnavailableError,
}));

vi.mock("@/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
}));

vi.mock("@/shared/auth/same-origin-mutation.server", () => ({
  isSameOriginMutation: (request: Request, baseUrl: string) =>
    request.headers.get("origin") === new URL(baseUrl).origin,
}));

vi.mock("@/shared/auth/index.server", async () => {
  const handler = await import(
    "@/shared/auth/authenticated-mutation-handler.server"
  );
  return { handleAuthenticatedMutation: handler.handleAuthenticatedMutation };
});

import {
  proxyContentCoverDelivery,
  proxyContentCoverRemoval,
  proxyContentCoverUpload,
} from "@/features/content-covers/api/content-cover-bff.server";
import { MAX_CONTENT_COVER_MUTATION_BYTES } from "@/shared/api/mutation-limits";

const coverId = "10000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000001";

describe("Content covers BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.getAccessToken.mockResolvedValue("access-token");
  });

  it("proxies only a canonical public rendition and preserves immutable headers", async () => {
    fakes.requestDelivery.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "cache-control": "public, max-age=31536000, immutable",
          "content-type": "image/webp",
        },
      }),
    );

    const response = await proxyContentCoverDelivery(
      new Request(`https://inside.example.test/api/content-covers/${coverId}/960`),
      coverId,
      "960",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(fakes.requestDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ coverId, width: "960" }),
    );

    const malformed = await proxyContentCoverDelivery(
      new Request("https://inside.example.test/api/content-covers/not-a-cover/1"),
      "not-a-cover",
      "1",
    );
    expect(malformed.status).toBe(404);

    const malformedWidth = await proxyContentCoverDelivery(
      new Request(`https://inside.example.test/api/content-covers/${coverId}/wide`),
      coverId,
      "wide",
    );
    expect(malformedWidth.status).toBe(404);
    expect(fakes.requestDelivery).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin authoring before identity or backend work", async () => {
    const response = await proxyContentCoverRemoval(
      removalRequest("https://attacker.example.test"),
      "material",
      ownerId,
    );

    expect(response.status).toBe(403);
    expect(fakes.getAccessToken).not.toHaveBeenCalled();
    expect(fakes.requestRemoval).not.toHaveBeenCalled();
  });

  it("streams a same-origin upload with manager authentication", async () => {
    fakes.requestUpload.mockResolvedValue(
      Response.json({ cover: { coverId, renditions: [] } }),
    );
    const form = new FormData();
    form.set("declaredSize", "3");
    form.set("checksumSha256", "a".repeat(64));
    form.set("expectedCoverId", "null");
    form.set("file", new Blob([new Uint8Array([1, 2, 3])]), "cover.png");
    const request = new Request(
      `https://inside.example.test/api/authoring/content-covers/material/${ownerId}`,
      {
        body: form,
        headers: { origin: "https://inside.example.test" },
        method: "PUT",
      },
    );

    const response = await proxyContentCoverUpload(
      request,
      "material",
      ownerId,
    );

    expect(response.status).toBe(200);
    expect(fakes.requestUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "access-token",
        ownerId,
        ownerKind: "material",
      }),
    );
  });

  it("rejects an oversized upload before identity or backend work", async () => {
    const request = uploadRequest();
    request.headers.set(
      "content-length",
      String(MAX_CONTENT_COVER_MUTATION_BYTES + 1),
    );

    const response = await proxyContentCoverUpload(
      request,
      "material",
      ownerId,
    );

    expect(response.status).toBe(413);
    expect(fakes.getAccessToken).not.toHaveBeenCalled();
    expect(fakes.requestUpload).not.toHaveBeenCalled();
  });

  it("validates and forwards removal concurrency state", async () => {
    fakes.requestRemoval.mockResolvedValue(Response.json({ cover: null }));

    const response = await proxyContentCoverRemoval(
      removalRequest("https://inside.example.test"),
      "topic",
      ownerId,
    );

    expect(response.status).toBe(200);
    expect(fakes.requestRemoval).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "access-token",
        expectedCoverId: coverId,
        ownerId,
        ownerKind: "topic",
      }),
    );
  });

  it("rejects a removal body outside the strict concurrency contract", async () => {
    const response = await proxyContentCoverRemoval(
      new Request(
        `https://inside.example.test/api/authoring/content-covers/topic/${ownerId}`,
        {
          body: JSON.stringify({ expectedCoverId: coverId, unexpected: true }),
          headers: {
            "content-type": "application/json",
            origin: "https://inside.example.test",
          },
          method: "DELETE",
        },
      ),
      "topic",
      ownerId,
    );

    expect(response.status).toBe(400);
    expect(fakes.requestRemoval).not.toHaveBeenCalled();
  });
});

function uploadRequest(): Request {
  const form = new FormData();
  form.set("declaredSize", "3");
  form.set("checksumSha256", "a".repeat(64));
  form.set("expectedCoverId", "null");
  form.set("file", new Blob([new Uint8Array([1, 2, 3])]), "cover.png");
  return new Request(
    `https://inside.example.test/api/authoring/content-covers/material/${ownerId}`,
    {
      body: form,
      headers: { origin: "https://inside.example.test" },
      method: "PUT",
    },
  );
}

function removalRequest(origin: string): Request {
  return new Request(
    `https://inside.example.test/api/authoring/content-covers/material/${ownerId}`,
    {
      body: JSON.stringify({ expectedCoverId: coverId }),
      headers: { "content-type": "application/json", origin },
      method: "DELETE",
    },
  );
}
