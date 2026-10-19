import { describe, expect, it, vi } from "vitest";

import { getMaterialPublicLink } from "@/_pages/material-authoring/api/get-material-public-link.server";

const materialId = "94000000-0000-4000-8000-000000000010";

describe("Постоянная ссылка для автора", () => {
  for (const publicationState of ["draft", "unpublished"] as const) {
    it(`не предлагает отправлять ${publicationState}`, async () => {
      const load = vi.fn().mockResolvedValue({
        ok: true,
        body: {
          materialId,
          publicationState,
          metadata: { slug: "previously-published" },
        },
      });
      await expect(
        getMaterialPublicLink(materialId, "author-token", load),
      ).resolves.toEqual({ kind: "ready", path: null });
    });
  }
  for (const status of [401, 403, 404, 503]) {
    it(`сохраняет отказ backend ${String(status)}`, async () => {
      const load = vi.fn().mockResolvedValue({
        ok: false,
        response: new Response(null, { status }),
      });
      await expect(
        getMaterialPublicLink(materialId, "author-token", load),
      ).resolves.toEqual({ kind: "rejected", status });
    });
  }
  it("не обращается к backend с неверным идентификатором", async () => {
    const load = vi.fn();
    await expect(
      getMaterialPublicLink("bad-id", "author-token", load),
    ).resolves.toEqual({ kind: "rejected", status: 404 });
    expect(load).not.toHaveBeenCalled();
  });
  it("отклоняет ответ другого материала", async () => {
    const load = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        materialId: "94000000-0000-4000-8000-000000000011",
        publicationState: "published",
        metadata: { slug: "other-material" },
      },
    });
    await expect(
      getMaterialPublicLink(materialId, "author-token", load),
    ).rejects.toThrow("identity mismatch");
  });
  it("берёт сохранённый slug, а не вычисляет его из нового названия", async () => {
    const load = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        materialId,
        publicationState: "published",
        metadata: { slug: "saved-material" },
      },
    });
    const result = await getMaterialPublicLink(
      materialId,
      "author-token",
      load,
    );
    expect(result).toEqual({
      kind: "ready",
      path: "/materials/saved-material",
    });
    expect(load).toHaveBeenCalledWith(materialId, "author-token");
  });
});
