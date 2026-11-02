import { describe, expect, it } from "vitest";

import type { ProductPage } from "@/entities/product-page";
import {
  courseTelegramHandle,
  splitTelegramNote,
} from "@/_pages/library-discovery/model/course-contact";

const faq = (note: string): ProductPage["blocks"][number] => ({
  id: "faq",
  kind: "cards",
  eyebrow: "",
  title: "Частые вопросы",
  lead: "",
  items: [{ title: "Вопрос", text: "Ответ", detailLabel: "", detail: "" }],
  note,
});
const page = (...blocks: ProductPage["blocks"]): ProductPage => ({
  card: null,
  blocks,
});

describe("splitTelegramNote", () => {
  it("отделяет ник Telegram от текста подписи", () => {
    expect(splitTelegramNote("Остались вопросы? @sachkova_mng")).toEqual({
      text: "Остались вопросы?",
      handle: "sachkova_mng",
    });
  });

  it("оставляет подпись без ника текстом", () => {
    expect(splitTelegramNote("Пиши на почту")).toEqual({
      text: "Пиши на почту",
      handle: undefined,
    });
  });

  it("не принимает слишком короткий ник Telegram", () => {
    expect(splitTelegramNote("Пиши @abc").handle).toBeUndefined();
  });
});

describe("courseTelegramHandle", () => {
  it("берёт ник из подписи блока частых вопросов", () => {
    expect(
      courseTelegramHandle(page(faq("Остались вопросы? @sachkova_mng"))),
    ).toBe("sachkova_mng");
  });

  it("не находит ник без блока вопросов или без ника в подписи", () => {
    expect(courseTelegramHandle(null)).toBeUndefined();
    expect(courseTelegramHandle(page(faq("")))).toBeUndefined();
    expect(
      courseTelegramHandle(page({ ...faq("@sachkova_mng"), id: "audience" })),
    ).toBeUndefined();
  });
});
