import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configureWebRuntime } from "../support/web-runtime";
import {
  interceptBackendHttp,
  expectSingleBackendRequest,
} from "../support/backend-http";
import { getMaterialPublicLink } from "@/_pages/material-authoring/api/get-material-public-link.server";

const materialId = "94000000-0000-4000-8000-000000000010";

const backend = vi.fn<(request: Request) => Promise<Response>>();
let expectedReads: number;
beforeEach(() => {
  configureWebRuntime();
  backend.mockReset();
  expectedReads = 1;
  interceptBackendHttp(backend);
});
afterEach(() => {
  expect(backend).toHaveBeenCalledTimes(expectedReads);
  if (expectedReads === 1)
    expectSingleBackendRequest(
      backend,
      "GET",
      `/authoring/materials/${materialId}`,
      "author-token",
    );
});
describe("Постоянная ссылка для автора", () => {
  for (const publicationState of ["draft", "unpublished"] as const) {
    it(`не предлагает отправлять ${publicationState}`, async () => {
      backend.mockResolvedValue(
        Response.json({
          materialId,
          publicationState,
          metadata: { slug: "previously-published" },
        }),
      );
      await expect(
        getMaterialPublicLink(materialId, "author-token"),
      ).resolves.toEqual({ kind: "ready", path: null });
    });
  }
  for (const status of [401, 403, 404, 503]) {
    it(`сохраняет отказ backend ${String(status)}`, async () => {
      backend.mockResolvedValue(new Response(null, { status }));
      await expect(
        getMaterialPublicLink(materialId, "author-token"),
      ).resolves.toEqual({ kind: "rejected", status });
    });
  }
  it("не обращается к backend с неверным идентификатором", async () => {
    expectedReads = 0;
    await expect(
      getMaterialPublicLink("bad-id", "author-token"),
    ).resolves.toEqual({ kind: "rejected", status: 404 });
    expect(backend).not.toHaveBeenCalled();
  });
  it("отклоняет ответ другого материала", async () => {
    backend.mockResolvedValue(
      Response.json({
        materialId: "94000000-0000-4000-8000-000000000011",
        publicationState: "published",
        metadata: { slug: "other-material" },
      }),
    );
    await expect(
      getMaterialPublicLink(materialId, "author-token"),
    ).rejects.toThrow("identity mismatch");
  });
  it("берёт сохранённый slug, а не вычисляет его из нового названия", async () => {
    backend.mockResolvedValue(
      Response.json({
        materialId,
        publicationState: "published",
        metadata: { slug: "saved-material" },
      }),
    );
    const result = await getMaterialPublicLink(materialId, "author-token");
    expect(result).toEqual({
      kind: "ready",
      path: "/materials/saved-material",
    });
    expect(backend).toHaveBeenCalledOnce();
  });
});
