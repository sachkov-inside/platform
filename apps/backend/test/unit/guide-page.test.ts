import { describe, expect, test } from "vitest";

import { guidePageSchema, guidePresentationSchema, readStoredGuidePage } from "../../src/modules/materials/domain/guide-page.js";

const page = {
  card: null,
  blocks: [
    { id: "hero", kind: "hero", lead: "Помощь — {support_term}, доступ — {access_term}.", highlights: [] },
    { id: "shift", kind: "text", title: "Работа меняется", paragraphs: ["Первый абзац."] },
    { id: "audience", kind: "cards", eyebrow: "", title: "Кому это нужно", lead: "", items: [{ title: "Новичкам", text: "Текст.", detailLabel: "", detail: "" }], note: "" },
    { id: "programme", kind: "steps", title: "Этапы", lead: "", items: [{ title: "Этап", text: "Текст." }], link: "" },
    { id: "stack", kind: "list", title: "Стек", text: "", items: ["Go"] },
    { id: "trial", kind: "trial", title: "Попробуй", text: "Текст.", link: "" },
  ],
};

describe("Guide page description", () => {
  test("accepts every block kind and the offer term substitutions", () => {
    expect(guidePageSchema.parse(page)).toEqual(page);
    expect(readStoredGuidePage(page)).toEqual(page);
    expect(readStoredGuidePage(null)).toBeNull();
  });

  test.each([
    ["an unknown block kind", { ...page, blocks: [{ id: "x", kind: "video", title: "Видео" }] }],
    ["an unknown key", { ...page, blocks: [{ ...page.blocks[0], price: 1 }] }],
    ["a duplicate block id", { ...page, blocks: [page.blocks[1], page.blocks[1]] }],
    ["a foreign substitution", { ...page, blocks: [{ ...page.blocks[0], lead: "Цена {price}" }] }],
    ["an unmatched brace", { ...page, blocks: [{ ...page.blocks[0], lead: "Скобка {support_term" }] }],
    ["untrimmed text", { ...page, blocks: [{ ...page.blocks[0], lead: " Лид" }] }],
    ["an empty required title", { ...page, blocks: [{ ...page.blocks[1], title: "" }] }],
    ["no blocks", { ...page, blocks: [] }],
    ["an invalid block id", { ...page, blocks: [{ ...page.blocks[1], id: "Shift" }] }],
  ])("rejects %s", (_name, value) => {
    expect(guidePageSchema.safeParse(value).success).toBe(false);
    expect(readStoredGuidePage(value)).toBe("invalid");
  });

  test("knows only the presentations the site can draw", () => {
    expect(guidePresentationSchema.options).toEqual(["default", "ai-first-process"]);
    expect(guidePresentationSchema.safeParse("working-with-agents").success).toBe(false);
  });
});
