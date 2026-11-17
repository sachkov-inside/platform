import type { Route } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getMaterialPreviewRoute,
  getMaterialPreviewVideo,
} from "@/_pages/material-authoring/api/get-material-preview-context";
import { buildMaterialPreviewRoute } from "@/_pages/material-authoring/model/preview-route";
import { configureWebRuntime } from "../support/web-runtime";
import { interceptBackendHttp } from "../support/backend-http";
import { authoringMaterialPreviewHref } from "@/shared/routing/authoring";

const productId = "95000000-0000-4000-8000-000000000001";
const otherProductId = "95000000-0000-4000-8000-000000000002";
const chapterZero = "95000000-0000-4000-8000-000000000010";
const chapterOne = "95000000-0000-4000-8000-000000000011";
const chapterTwo = "95000000-0000-4000-8000-000000000012";
const intro = "95000000-0000-4000-8000-000000000020";
const setup = "95000000-0000-4000-8000-000000000021";
const harness = "95000000-0000-4000-8000-000000000022";
const glossary = "95000000-0000-4000-8000-000000000023";
const returnHref: Route = "/authoring/materials?state=draft";

const order = {
  chapters: [
    { id: chapterZero, name: "Глава 0. Старт", summary: "" },
    { id: chapterOne, name: "Глава 1. Harness", summary: "" },
    { id: chapterTwo, name: "Глава 2. Контекст", summary: "" },
  ],
  items: [
    item(intro, "Как устроен курс", chapterZero, "published"),
    // Материал вне глав стоит посреди общего порядка, но показывается после глав.
    item(glossary, "Словарь", null, "draft"),
    item(setup, "Подготовка окружения", chapterZero, "draft"),
    item(harness, "Первый harness", chapterOne, "unpublished"),
  ],
  name: "Inside AI Engineering",
};

interface BackendReply {
  readonly path: string;
  readonly response: Response | Error;
}
let replies: BackendReply[];
const backend = vi.fn<(request: Request) => Promise<Response>>();
beforeEach(() => {
  configureWebRuntime();
  replies = [];
  backend.mockReset();
  backend.mockImplementation(() => {
    const response = replies[backend.mock.calls.length - 1]?.response;
    return response === undefined
      ? Promise.reject(new Error("Unexpected backend request"))
      : response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve(response);
  });
  interceptBackendHttp(backend);
});
afterEach(() => {
  expect(backend).toHaveBeenCalledTimes(replies.length);
  replies.forEach((reply, index) => {
    const request = backend.mock.calls[index]?.[0];
    if (request === undefined)
      throw new Error("Expected external backend request");
    expect(request.method).toBe("GET");
    expect(request.url).toBe(`https://platform-api.example.test${reply.path}`);
    expect(request.headers.get("authorization")).toBe("Bearer access-token");
    expect(request.body).toBeNull();
  });
});
function previewRouteFromBackend(
  input: Parameters<typeof getMaterialPreviewRoute>[0],
  reply: Response | Error,
) {
  replies.push({
    path: `/authoring/products/${productId}/order`,
    response: reply,
  });
  return getMaterialPreviewRoute(input);
}
function previewVideoFromBackend(
  materialId: string,
  token: string,
  reply: Response | Error,
) {
  replies.push({ path: `/authoring/materials/${materialId}`, response: reply });
  return getMaterialPreviewVideo(materialId, token);
}

describe("Material preview route", () => {
  it("walks chapters in declared order and then materials outside chapters", () => {
    const route = buildMaterialPreviewRoute({
      currentMaterialId: harness,
      hrefOf,
      order,
      otherProducts: [],
    });

    expect(route?.sections.map(({ name }) => name)).toEqual([
      "Глава 0. Старт",
      "Глава 1. Harness",
      "Глава 2. Контекст",
      "Вне глав",
    ]);
    // Пустая глава остаётся видимой.
    expect(route?.sections[2]?.items).toEqual([]);
    expect(route).toMatchObject({
      next: {
        href: `/authoring/materials/${glossary}/preview?from=%2Fauthoring%2Fmaterials%3Fstate%3Ddraft&product=${productId}`,
        publicationState: "draft",
      },
      position: 3,
      previous: {
        href: `/authoring/materials/${setup}/preview?from=%2Fauthoring%2Fmaterials%3Fstate%3Ddraft&product=${productId}`,
        title: "Подготовка окружения",
      },
      total: 4,
    });
    expect(
      route?.sections.flatMap(({ items }) => items).filter((i) => i.current),
    ).toHaveLength(1);
  });

  it("has no previous material at the start and no next one at the end", () => {
    const first = buildMaterialPreviewRoute({
      currentMaterialId: intro,
      hrefOf,
      order,
      otherProducts: [],
    });
    const last = buildMaterialPreviewRoute({
      currentMaterialId: glossary,
      hrefOf,
      order,
      otherProducts: [],
    });

    expect(first).toMatchObject({ position: 1, previous: null });
    expect(last).toMatchObject({ next: null, position: 4 });
  });

  it("keeps a product without chapters as one unnamed list", () => {
    const route = buildMaterialPreviewRoute({
      currentMaterialId: setup,
      hrefOf,
      order: {
        ...order,
        chapters: [],
        items: order.items.map((entry) => ({ ...entry, chapterId: null })),
      },
      otherProducts: [],
    });

    expect(route?.sections.map(({ name }) => name)).toEqual([null]);
    expect(route).toMatchObject({ position: 3, total: 4 });
  });

  it("gives no route to a material outside the composition", () => {
    expect(
      buildMaterialPreviewRoute({
        currentMaterialId: "95000000-0000-4000-8000-000000000099",
        hrefOf,
        order,
        otherProducts: [],
      }),
    ).toBeNull();
  });

  it("keeps the selected product and the return address in every transition", async () => {
    const reply = successfulOrder();
    const route = await previewRouteFromBackend(
      {
        accessToken: "access-token",
        productId,
        products: [
          { id: otherProductId, name: "Другое руководство" },
          { id: productId, name: "Inside AI Engineering" },
        ],
        materialId: setup,
        returnHref,
      },
      reply,
    );

    expect(backend).toHaveBeenCalledOnce();
    expect(route).toMatchObject({
      productName: "Inside AI Engineering",
      kind: "ready",
      next: {
        href: `/authoring/materials/${harness}/preview?from=%2Fauthoring%2Fmaterials%3Fstate%3Ddraft&product=${productId}`,
      },
      otherProducts: [
        {
          href: `/authoring/materials/${setup}/preview?from=%2Fauthoring%2Fmaterials%3Fstate%3Ddraft&product=${otherProductId}`,
          name: "Другое руководство",
        },
      ],
    });
  });

  it("falls back to the first product when the address names a foreign one", async () => {
    const reply = successfulOrder();
    await previewRouteFromBackend(
      {
        accessToken: "access-token",
        productId: otherProductId,
        products: [{ id: productId, name: "Inside AI Engineering" }],
        materialId: setup,
        returnHref,
      },
      reply,
    );

    expect(backend).toHaveBeenCalledOnce();
  });

  it("reads no product for a material outside every product", async () => {
    await expect(
      getMaterialPreviewRoute({
        accessToken: "access-token",
        products: [],
        materialId: setup,
        returnHref,
      }),
    ).resolves.toBeNull();
    expect(backend).not.toHaveBeenCalled();
  });

  it("names a failed product read instead of hiding the material", async () => {
    const input = {
      accessToken: "access-token",
      products: [{ id: productId, name: "Inside AI Engineering" }],
      materialId: setup,
      returnHref,
    };

    await expect(
      previewRouteFromBackend(input, new Error("External backend unavailable")),
    ).resolves.toEqual({ kind: "unavailable", reference: "unavailable" });
    await expect(
      previewRouteFromBackend(input, response({}, 404)),
    ).resolves.toEqual({ kind: "unavailable", reference: "product-not-found" });
    await expect(
      previewRouteFromBackend(
        { ...input, materialId: "95000000-0000-4000-8000-000000000099" },
        successfulOrder(),
      ),
    ).resolves.toEqual({
      kind: "unavailable",
      reference: "product-order-changed",
    });
  });

  it("does not hide a permission denial behind the material", async () => {
    await expect(
      previewRouteFromBackend(
        {
          accessToken: "access-token",
          products: [{ id: productId, name: "Inside AI Engineering" }],
          materialId: setup,
          returnHref,
        },
        response({}, 403),
      ),
    ).resolves.toBe("unauthorized");
  });
});

describe("Material preview video", () => {
  it("hands the player the attached video and says whether it is ready", async () => {
    await expect(
      previewVideoFromBackend(setup, "access-token", current("ready")),
    ).resolves.toEqual({
      durationSeconds: 754,
      kind: "attached",
      cover: {
        coverId: "02000000-0000-4000-8000-000000000011",
        renditions: [{ width: 1280, height: 720 }],
      },
      ready: true,
      title: "Запись урока",
      videoId: "95000000-0000-4000-8000-000000000030",
    });
    await expect(
      previewVideoFromBackend(setup, "access-token", current("processing")),
    ).resolves.toEqual({
      durationSeconds: 754,
      kind: "attached",
      cover: {
        coverId: "02000000-0000-4000-8000-000000000011",
        renditions: [{ width: 1280, height: 720 }],
      },
      ready: false,
      title: "Запись урока",
      videoId: "95000000-0000-4000-8000-000000000030",
    });
  });

  it("says plainly that no video is attached", async () => {
    await expect(
      previewVideoFromBackend(
        setup,
        "access-token",
        response({ primaryVideo: null }, 200),
      ),
    ).resolves.toEqual({ kind: "none" });
  });

  it("does not invent a video state when the read fails", async () => {
    await expect(
      previewVideoFromBackend(setup, "access-token", response({}, 503)),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      previewVideoFromBackend(setup, "access-token", response({}, 200)),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      previewVideoFromBackend(
        setup,
        "access-token",
        new Error("External backend unavailable"),
      ),
    ).resolves.toEqual({ kind: "unavailable" });
  });
});

function item(
  materialId: string,
  title: string,
  chapterId: string | null,
  publicationState: "draft" | "published" | "unpublished",
) {
  return { chapterId, materialId, publicationState, title };
}

function hrefOf(materialId: string): Route {
  return authoringMaterialPreviewHref(materialId, returnHref, productId);
}

function response(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function successfulOrder() {
  return response(
    {
      archived: false,
      chapters: order.chapters.map((chapter, index) => ({
        ...chapter,
        ordinal: index + 1,
      })),
      items: order.items.map((entry, index) => ({
        ...entry,
        ordinal: index + 1,
        stepGroup: null,
      })),
      name: order.name,
      orderVersion: "a".repeat(64),
      productId: productId,
    },
    200,
  );
}

function current(state: "processing" | "ready") {
  return response(
    {
      cover: {
        coverId: "02000000-0000-4000-8000-000000000011",
        renditions: [{ width: 1280, height: 720 }],
      },
      contentVersion: 3,
      primaryVideo: {
        durationSeconds: 754,
        origin: "platform_upload",
        protected: true,
        state,
        title: "Запись урока",
        videoId: "95000000-0000-4000-8000-000000000030",
      },
    },
    200,
  );
}
