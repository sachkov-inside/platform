import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  proxyContentCoverDelivery as realproxyContentCoverDelivery,
  proxyContentCoverRemoval as realproxyContentCoverRemoval,
  proxyContentCoverUpload as realproxyContentCoverUpload,
} from "@/features/content-covers/api/content-cover-bff.server";

const proxyContentCoverDelivery = (
  ...args: Parameters<typeof realproxyContentCoverDelivery>
) => session(() => realproxyContentCoverDelivery(...args));
const proxyContentCoverRemoval = (
  ...args: Parameters<typeof realproxyContentCoverRemoval>
) => session(() => realproxyContentCoverRemoval(...args));
const proxyContentCoverUpload = (
  ...args: Parameters<typeof realproxyContentCoverUpload>
) => session(() => realproxyContentCoverUpload(...args));

const coverId = "10000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000001";

describe("Content covers BFF", () => {
  beforeEach(async () => {
    backend.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
    session = await realBffSession();
    interceptBackendHttp(backend);
  });
  afterEach(() => vi.useRealTimers());

  it("proxies only a canonical public rendition and preserves immutable headers", async () => {
    backend.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "cache-control": "public, max-age=31536000, immutable",
          "content-type": "image/webp",
        },
      }),
    );

    const response = await proxyContentCoverDelivery(
      new Request(
        `https://inside.example.test/api/content-covers/${coverId}/960`,
      ),
      coverId,
      "960",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("content-type")).toBe("image/webp");
    const outgoing = expectSingleBackendRequest(
      backend,
      "GET",
      `/content-covers/${coverId}/960`,
      null,
    );
    expect(outgoing.redirect).toBe("manual");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      1, 2, 3,
    ]);

    const malformed = await proxyContentCoverDelivery(
      new Request(
        "https://inside.example.test/api/content-covers/not-a-cover/1",
      ),
      "not-a-cover",
      "1",
    );
    expect(malformed.status).toBe(404);

    const malformedWidth = await proxyContentCoverDelivery(
      new Request(
        `https://inside.example.test/api/content-covers/${coverId}/wide`,
      ),
      coverId,
      "wide",
    );
    expect(malformedWidth.status).toBe(404);
    expect(backend).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin authoring before identity or backend work", async () => {
    const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
    const response = await proxyContentCoverRemoval(
      removalRequest("https://attacker.example.test"),
      "material",
      ownerId,
    );

    expect(response.status).toBe(403);
    expect(tokenReads).not.toHaveBeenCalled();
    expect(backend).not.toHaveBeenCalled();
  });

  it("streams a same-origin upload with manager authentication", async () => {
    backend.mockResolvedValue(
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
    const outgoing = expectSingleBackendRequest(
      backend,
      "PUT",
      `/authoring/content-covers/material/${ownerId}`,
    );
    const uploaded = await outgoing.formData();
    expect(uploaded.get("declaredSize")).toBe("3");
    expect(uploaded.get("checksumSha256")).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(uploaded.get("expectedCoverId")).toBe("null");
    const file = uploaded.get("file");
    expect(file).toBeInstanceOf(File);
    if (!(file instanceof File)) throw new Error("Expected cover File");
    expect(file.name).toBe("cover.png");
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([
      1, 2, 3,
    ]);
  });

  it("rejects an oversized upload before identity or backend work", async () => {
    const tokenReads = vi.spyOn(sessionAdapter, "accessToken");
    const request = uploadRequest();
    request.headers.set("content-length", "10551297");

    const response = await proxyContentCoverUpload(
      request,
      "material",
      ownerId,
    );

    expect(response.status).toBe(413);
    expect(tokenReads).not.toHaveBeenCalled();
    expect(backend).not.toHaveBeenCalled();
  });

  it("validates and forwards removal concurrency state", async () => {
    backend.mockResolvedValue(Response.json({ cover: null }));

    const response = await proxyContentCoverRemoval(
      removalRequest("https://inside.example.test"),
      "topic",
      ownerId,
    );

    expect(response.status).toBe(200);
    expect(
      await expectSingleBackendRequest(
        backend,
        "DELETE",
        `/authoring/content-covers/topic/${ownerId}`,
      ).json(),
    ).toEqual({ expectedCoverId: "10000000-0000-4000-8000-000000000001" });
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
    expect(backend).not.toHaveBeenCalled();
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
