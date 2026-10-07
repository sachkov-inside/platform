import { describe, expect, test } from "vitest";

import {
  productPageSchema,
  productPresentationSchema,
  readStoredProductPage,
} from "../../src/modules/materials/domain/product-page.js";

const page = {
  card: null,
  blocks: [
    {
      id: "hero",
      kind: "hero",
      badge: "{support_term}",
      lead: "Помощь — {support_term}, доступ — {access_term}.",
      highlights: [],
    },
    {
      id: "shift",
      kind: "text",
      title: "Работа меняется",
      paragraphs: ["Первый абзац."],
    },
    {
      id: "audience",
      kind: "cards",
      eyebrow: "",
      title: "Кому это нужно",
      lead: "",
      items: [
        { title: "Новичкам", text: "Текст.", detailLabel: "", detail: "" },
      ],
      note: "",
    },
    {
      id: "programme",
      kind: "steps",
      title: "Этапы",
      lead: "",
      items: [{ title: "Этап", text: "Текст." }],
      link: "",
    },
    { id: "stack", kind: "list", title: "Стек", text: "", items: ["Go"] },
    { id: "trial", kind: "trial", title: "Попробуй", text: "Текст.", link: "" },
  ],
};

describe("Product page description", () => {
  test("accepts every block kind and the offer term substitutions", () => {
    expect(productPageSchema.parse(page)).toEqual(page);
    expect(readStoredProductPage(page)).toEqual(page);
    expect(readStoredProductPage(null)).toBeNull();
  });

  test.each([
    [
      "an unknown block kind",
      { ...page, blocks: [{ id: "x", kind: "video", title: "Видео" }] },
    ],
    ["an unknown key", { ...page, blocks: [{ ...page.blocks[0], price: 1 }] }],
    [
      "a duplicate block id",
      { ...page, blocks: [page.blocks[1], page.blocks[1]] },
    ],
    [
      "a foreign substitution",
      { ...page, blocks: [{ ...page.blocks[0], lead: "Цена {price}" }] },
    ],
    [
      "untrimmed text",
      { ...page, blocks: [{ ...page.blocks[0], lead: " Лид" }] },
    ],
    [
      "an empty required title",
      { ...page, blocks: [{ ...page.blocks[1], title: "" }] },
    ],
    ["no blocks", { ...page, blocks: [] }],
    [
      "more blocks than the page allows",
      {
        ...page,
        blocks: Array.from({ length: 17 }, (_, index) => ({
          ...page.blocks[1],
          id: `text-${String(index)}`,
        })),
      },
    ],
    [
      "more items than a block allows",
      {
        ...page,
        blocks: [
          {
            ...page.blocks[2],
            items: Array.from({ length: 13 }, (_, index) => ({
              title: `Пункт ${String(index)}`,
              text: "Текст.",
              detailLabel: "",
              detail: "",
            })),
          },
        ],
      },
    ],
    [
      "an invalid block id",
      { ...page, blocks: [{ ...page.blocks[1], id: "Shift" }] },
    ],
    [
      "an item caption without its value",
      {
        ...page,
        blocks: [
          {
            ...page.blocks[2],
            items: [
              {
                title: "Пункт",
                text: "Текст.",
                detailLabel: "В репозитории",
                detail: "",
              },
            ],
          },
        ],
      },
    ],
    [
      "a second hero block",
      {
        ...page,
        blocks: [page.blocks[0], { ...page.blocks[0], id: "hero-again" }],
      },
    ],
    [
      "a description larger than the page limit",
      {
        ...page,
        blocks: [
          {
            ...page.blocks[1],
            paragraphs: [
              "а".repeat(3999),
              "б".repeat(3999),
              "в".repeat(3999),
              "г".repeat(3999),
              "д".repeat(3999),
            ],
          },
        ],
      },
    ],
  ])("rejects %s", (_name, value) => {
    expect(productPageSchema.safeParse(value).success).toBe(false);
    expect(readStoredProductPage(value)).toBe("invalid");
  });

  test("an author may write braces and omit the Home card caption", () => {
    const withBraces = {
      blocks: [
        {
          ...page.blocks[1],
          paragraphs: ["Объект { ключ: значение } в коде."],
        },
      ],
    };
    expect(productPageSchema.parse(withBraces)).toEqual({
      ...withBraces,
      card: null,
    });
  });

  test("reads a description saved before the hero badge existed", () => {
    const hero = productPageSchema.parse({
      card: null,
      blocks: [{ id: "hero", kind: "hero", lead: "Лид.", highlights: [] }],
    }).blocks[0];
    expect(hero).toEqual({
      id: "hero",
      kind: "hero",
      badge: "",
      lead: "Лид.",
      highlights: [],
    });
  });

  test("knows only the presentations the site can draw", () => {
    expect(productPresentationSchema.options).toEqual([
      "default",
      "ai-first-process",
      "ai-engineering-course",
    ]);
    expect(
      productPresentationSchema.safeParse("working-with-agents").success,
    ).toBe(false);
  });
});
