import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/auth/index.server", () => ({
  getPlatformAccessToken: vi.fn(),
  LogtoSessionUnavailableError: class extends Error {},
  readLogtoBffConfig: vi.fn().mockReturnValue({}),
}));

import { getSeriesOrder } from "@/_pages/series-order/api/get-series-order";
import { executeReorderSeries } from "@/_pages/series-order/api/reorder-series";

const seriesId = "96000000-0000-4000-8000-000000000001";
const firstId = "96000000-0000-4000-8000-000000000002";
const secondId = "96000000-0000-4000-8000-000000000003";
const chapterId = "96000000-0000-4000-8000-000000000004";
const orderVersion = "a".repeat(64);

describe("Series order web adapters", () => {
  it("maps the backend Series contract to the Russian playlist presentation", async () => {
    const request = vi.fn().mockResolvedValue({
      body: {
        archived: false,
        chapters: [
          { id: chapterId, name: "Проект и CI", ordinal: 1, summary: "Первый абзац.\n\nВторой абзац." },
        ],
        items: [
          { chapterId, materialId: firstId, ordinal: 1, publicationState: "published", title: "Первый" },
          { materialId: secondId, ordinal: 2, publicationState: "draft", title: null },
        ],
        name: "Создание Platform Inside",
        orderVersion,
        seriesId,
      },
      ok: true,
      response: Response.json({}),
    });

    await expect(getSeriesOrder(seriesId, "access-token", request)).resolves.toEqual({
      kind: "ready",
      order: {
        archived: false,
        chapters: [
          { id: chapterId, name: "Проект и CI", summary: "Первый абзац.\n\nВторой абзац." },
        ],
        items: [
          { chapterId, materialId: firstId, publicationState: "published", title: "Первый" },
          { chapterId: null, materialId: secondId, publicationState: "draft", title: "Без названия" },
        ],
        name: "Создание Platform Inside",
        orderVersion,
        seriesId,
      },
    });
  });

  it("passes the complete chapter list and placement and rejects a malformed chapter", async () => {
    const form = validFormData();
    const chapters = [{ id: chapterId, name: "  Проект и CI  ", summary: "" }];
    form.set("chapters", JSON.stringify(chapters));
    form.set("chapterAssignments", JSON.stringify({ [firstId]: chapterId }));
    const save = vi.fn().mockResolvedValue({ body: { orderVersion, seriesId }, ok: true, response: Response.json({}) });
    await expect(executeReorderSeries(form, "token", save)).resolves.toMatchObject({ kind: "saved" });
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        chapterAssignments: { [firstId]: chapterId },
        chapters: [{ id: chapterId, name: "Проект и CI", summary: "" }],
      }),
      "token",
    );
    save.mockClear();
    form.set("chapters", JSON.stringify([{ id: chapterId, name: " ", summary: "" }]));
    await expect(executeReorderSeries(form, "token", save)).resolves.toEqual({ kind: "error", reference: "series-order-form" });
    expect(save).not.toHaveBeenCalled();
  });

  it("passes explicit step assignments and rejects malformed maps while keeping legacy omission", async () => {
    const form = validFormData();
    form.set("stepGroups", JSON.stringify({ [firstId]: "  Release  " }));
    const save = vi.fn().mockResolvedValue({ body: { orderVersion, seriesId }, ok: true, response: Response.json({}) });
    await expect(executeReorderSeries(form, "token", save)).resolves.toMatchObject({ kind: "saved" });
    expect(save).toHaveBeenLastCalledWith({ expectedOrderVersion: orderVersion, orderedMaterialIds: [secondId, firstId], seriesId, stepGroups: { [firstId]: "Release" } }, "token");
    form.set("stepGroups", "{}");
    await executeReorderSeries(form, "token", save);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ stepGroups: {} }), "token");
    save.mockClear();
    form.set("stepGroups", JSON.stringify({ [firstId]: " " }));
    await expect(executeReorderSeries(form, "token", save)).resolves.toEqual({ kind: "error", reference: "series-order-form" });
    expect(save).not.toHaveBeenCalled();
  });

  it("submits one complete order and maps optimistic conflicts", async () => {
    const formData = validFormData();
    const save = vi.fn().mockResolvedValue({
      body: { orderVersion: "b".repeat(64), seriesId },
      ok: true,
      response: Response.json({}),
    });
    await expect(executeReorderSeries(formData, "access-token", save)).resolves.toEqual({
      kind: "saved",
      orderVersion: "b".repeat(64),
    });
    expect(save).toHaveBeenCalledWith(
      {
        expectedOrderVersion: orderVersion,
        orderedMaterialIds: [secondId, firstId],
        seriesId,
      },
      "access-token",
    );

    const conflict = vi.fn().mockResolvedValue({
      ok: false,
      problem: { code: "stale_series_order" },
      response: Response.json({}, { status: 409 }),
    });
    await expect(
      executeReorderSeries(formData, "access-token", conflict),
    ).resolves.toEqual({ kind: "conflict" });
  });
});

function validFormData(): FormData {
  const formData = new FormData();
  formData.set("expectedOrderVersion", orderVersion);
  formData.set("orderedMaterialIds", JSON.stringify([secondId, firstId]));
  formData.set("seriesId", seriesId);
  return formData;
}
