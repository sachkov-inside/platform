import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  readingProduct,
  readingMaterials,
  readingTopic,
} from "../../../../scenarios/reading.mjs";
import { realBffSession } from "../support/real-bff-session";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let session: Awaited<ReturnType<typeof realBffSession>>;

import {
  handleMaterialOpen as realHandleMaterialOpen,
  handleProductContinuation as realHandleProductContinuation,
} from "@/features/reading-progress.server";
import { handlePersonalHome as realHandlePersonalHome } from "@/features/reading-progress.server";
const handleMaterialOpen = (request: Request) =>
  session(() => realHandleMaterialOpen(request));
const handleProductContinuation = (request: Request) =>
  session(() => realHandleProductContinuation(request));
const handlePersonalHome = (request: Request) =>
  session(() => realHandlePersonalHome(request));
const video = readingMaterials.find((material) => material.format === "video");
if (video === undefined) throw new Error("Missing canonical video material");
const materialId = video.materialId;
const commandId = "20000000-0000-4000-8000-000000000001";
function request(
  input: Record<string, unknown>,
  origin = "https://inside.example.test",
) {
  const body = JSON.stringify(input);
  return new Request("https://inside.example.test/api/reading-progress/open", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body,
  });
}
beforeEach(async () => {
  backend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
  session = await realBffSession();
  vi.stubGlobal("fetch", backend);
});
afterEach(() => vi.useRealTimers());

it("authenticates visible-open commands, preserves replay and keeps responses private", async () => {
  const saved = { openedAt: "2026-09-07T00:00:00.000Z", replayed: true };
  backend.mockResolvedValueOnce(Response.json(saved));
  const response = await handleMaterialOpen(
    request({ materialId, commandId, contentVersion: 4 }),
  );
  expect(await response.json()).toEqual({ kind: "saved", ...saved });
  expect(
    await expectBackendRequest("POST", "/reading-activity/opens").json(),
  ).toEqual({ materialId, commandId, contentVersion: 4 });
  expect(response.headers.get("cache-control")).toBe("no-store, private");
});
it("rejects cross-origin and user-supplied Account before sending an open", async () => {
  expect(
    (await handleMaterialOpen(request({}, "https://outside.test"))).status,
  ).toBe(403);
  expect(
    await (
      await handleMaterialOpen(
        request({
          materialId,
          commandId,
          contentVersion: 4,
          accountId: materialId,
        }),
      )
    ).json(),
  ).toEqual({ kind: "invalid_input" });
  expect(backend).not.toHaveBeenCalled();
});
it("does not confirm unavailable, stale-version or malformed success", async () => {
  backend
    .mockResolvedValueOnce(new Response(null, { status: 409 }))
    .mockResolvedValueOnce(Response.json({}))
    .mockRejectedValueOnce(new Error("lost"));
  for (const kind of ["conflict", "unavailable", "unavailable"])
    expect(
      await (
        await handleMaterialOpen(
          request({ materialId, commandId, contentVersion: 4 }),
        )
      ).json(),
    ).toEqual({ kind });
});
it("serves a private empty Home and limits failure to its personal layer", async () => {
  backend
    .mockResolvedValueOnce(Response.json({ video: null, product: null }))
    .mockResolvedValueOnce(
      Response.json([{ material: { availability: "locked" } }]),
    )
    .mockRejectedValueOnce(new Error("offline"));
  const response = await handlePersonalHome(
    request({ accountId: "untrusted" }),
  );
  expect(await response.json()).toEqual({ kind: "ready", continuation: {} });
  expectBackendRequest("GET", "/reading-activity/learning-home");
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  for (let index = 0; index < 2; index++)
    expect(await (await handlePersonalHome(request({}))).json()).toEqual({
      kind: "unavailable",
    });
});

const productId = readingProduct.id;
const projection = {
  materialId,
  contentVersion: 1,
  slug: video.slug,
  title: video.title,
  summary: video.summary,
  access: "free",
  availability: "available",
  publishedAt: video.publishedAt,
  primaryVideoId: commandId,
  primaryVideoDurationSeconds: 300,
  cover: null,
  format: { id: "video", name: "Видео", slug: "video" },
  topic: readingTopic,
  tags: [],
  productMemberships: [],
};
it("maps published covers, saved position and a resumed collection to existing Home cards", async () => {
  backend.mockResolvedValueOnce(
    Response.json({
      video: {
        material: projection,
        lastOpenedAt: "2026-09-07T00:00:00.000Z",
        resume: { kind: "position", positionSeconds: 123 },
      },
      product: {
        collection: {
          id: productId,
          slug: readingProduct.slug,
          name: readingProduct.name,
          summary: "A product",
          cover: null,
          count: 120,
          previewItems: [projection],
        },
        read: 1,
        total: 120,
        continuation: {
          materialSlug: video.slug,
          resume: { kind: "position", positionSeconds: 123 },
        },
      },
    }),
  );
  const result: unknown = await (await handlePersonalHome(request({}))).json();
  expect(result).toMatchObject({
    kind: "ready",
    continuation: {
      video: {
        material: { materialId, slug: "performance-lesson-1" },
        label: "Продолжить с 2:03",
      },
      product: { collection: { id: productId }, read: 1, total: 120 },
    },
  });
});
it("rejects inaccessible video and impossible product counts in upstream responses", async () => {
  backend.mockResolvedValueOnce(
    Response.json({
      video: {
        material: { ...projection, availability: "locked" },
        lastOpenedAt: "2026-09-07T00:00:00.000Z",
        resume: { kind: "position", positionSeconds: 10 },
      },
      product: null,
    }),
  );
  expect(await (await handlePersonalHome(request({}))).json()).toEqual({
    kind: "unavailable",
  });
  backend.mockResolvedValueOnce(
    Response.json({
      video: null,
      product: {
        collection: {
          id: productId,
          slug: readingProduct.slug,
          name: readingProduct.name,
          summary: null,
          cover: null,
          count: 120,
          previewItems: [],
        },
        read: 121,
        total: 120,
        continuation: null,
      },
    }),
  );
  expect(await (await handlePersonalHome(request({}))).json()).toEqual({
    kind: "unavailable",
  });
});

it("keeps product continuation private, binds the requested slug and rejects unknown response shapes", async () => {
  const value = {
    collection: {
      id: productId,
      slug: readingProduct.slug,
      name: readingProduct.name,
      summary: null,
      cover: null,
      count: 120,
      previewItems: [],
    },
    read: 1,
    total: 120,
    continuation: {
      materialSlug: video.slug,
      resume: { kind: "position", positionSeconds: 123 },
    },
  };
  backend.mockImplementation(() => Promise.resolve(Response.json(value)));
  const response = await handleProductContinuation(
    request({ slug: readingProduct.slug, accountId: "untrusted" }),
  );
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  expect(await response.json()).toEqual({
    kind: "ready",
    read: 1,
    total: 120,
    continuation: {
      materialSlug: "performance-lesson-1",
      label: "Продолжить с 2:03",
    },
  });
  expectBackendRequest(
    "GET",
    "/reading-activity/product-continuation/performance-course",
  );
  expect(
    await (
      await handleProductContinuation(request({ slug: "another" }))
    ).json(),
  ).toEqual({ kind: "unavailable" });
  expect(
    (
      await handleProductContinuation(
        request({ slug: readingProduct.slug }, "https://outside.test"),
      )
    ).status,
  ).toBe(403);
});

function expectBackendRequest(method: string, path: string): Request {
  const request = backend.mock.calls.at(-1)?.[0];
  if (request === undefined) throw new Error("Expected backend request");
  expect(request.method).toBe(method);
  expect(request.url).toBe(`https://platform-api.example.test${path}`);
  expect(request.headers.get("authorization")).toBe("Bearer trusted-token");
  return request;
}
