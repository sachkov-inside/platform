import { describe, expect, it } from "vitest";
import {
  helpScreen,
  mainMenu,
  productCard,
  productList,
  type LearnerProduct,
} from "../../src/modules/course-activation/learner-view.js";

const product: LearnerProduct = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "ai-engineering",
  name: "AI Engineering",
  programmeUrl: "https://sachkov.dev/products/ai-engineering/programme",
  materials: { state: "available" },
  community: { state: "available" },
};

describe("learner course navigation", () => {
  it("keeps only products in Мои продукты and returns to the menu", () => {
    expect(productList([product]).buttons).toEqual([
      {
        text: "AI Engineering",
        callbackData: "access:product:11111111-1111-4111-8111-111111111111",
      },
      { text: "На платформу", url: "https://sachkov.dev" },
      { text: "Помощь", callbackData: "access:help" },
      { text: "Назад", callbackData: "access:menu" },
    ]);
  });

  it("sends a learner with a sign-in problem to Telegram, never to email", () => {
    const text = helpScreen("help_signin").text;
    expect(text).toContain("Войдите через Telegram.");
    expect(text).toContain("с телефона");
    expect(text).not.toMatch(/почт/u);
  });

  it("returns from help without a product to the menu", () => {
    expect(helpScreen("help").buttons.at(-1)).toEqual({
      text: "Назад",
      callbackData: "access:menu",
    });
  });

  it("invites a guest to the course, the Trainer and ИИ-модели", () => {
    expect(mainMenu({ kind: "guest" })).toEqual({
      text: "Здесь можно узнать о курсе AI Engineering, проверить свои знания в Тренажёре и посмотреть, какие ИИ-модели сейчас сильнее и сколько они стоят.",
      buttons: [
        {
          text: "Курс AI Engineering",
          url: "https://sachkov.dev/products/ai-engineering",
        },
        { text: "Тренажёр", callbackData: "trainer:open" },
        { text: "ИИ-модели", callbackData: "ai-models:open" },
        {
          text: "Уже есть аккаунт",
          url: "https://sachkov.dev/auth/sign-in?returnTo=%2Faccount%2Faccess",
        },
        { text: "Помощь", callbackData: "access:help" },
      ],
    });
  });

  it.each([
    {
      who: "a course learner",
      products: [product],
      author: false,
      sections: ["Мои продукты", "Тренажёр", "ИИ-модели", "Помощь"],
    },
    {
      who: "a linked person without products",
      products: [],
      author: false,
      sections: ["Курс AI Engineering", "Тренажёр", "ИИ-модели", "Помощь"],
    },
    {
      who: "an author with another product",
      products: [{ ...product, slug: "another-course", name: "Another" }],
      author: true,
      sections: [
        "Мои продукты",
        "Курс AI Engineering",
        "Тренажёр",
        "ИИ-модели",
        "Помощь",
        "Управление",
      ],
    },
  ])("shows $who only their own sections", ({ products, author, sections }) => {
    const menu = mainMenu({ kind: "linked", products, author });
    expect(menu.text).toBe("Выберите раздел.");
    expect(menu.buttons.map((button) => button.text)).toEqual(sections);
  });

  it("opens Мои продукты and Управление from the menu", () => {
    const { buttons } = mainMenu({
      kind: "linked",
      products: [product],
      author: true,
    });
    expect(buttons).toContainEqual({
      text: "Мои продукты",
      callbackData: "access:own",
    });
    expect(buttons).toContainEqual({
      text: "Управление",
      callbackData: "author:home:0",
    });
  });

  it("opens course topic navigation for a confirmed member of its group", () => {
    expect(
      productCard(product, { kind: "member" }, "https://t.me/c/4421726276/1")
        .buttons,
    ).toContainEqual({
      text: "Навигация по группе",
      url: "https://t.me/c/4421726276/14",
    });
  });

  it.each(["expired", "revoked", "unavailable"] as const)(
    "hides group actions when the community right is %s",
    (state) => {
      const card = productCard(
        { ...product, community: { state } },
        { kind: "member" },
        "https://t.me/c/4421726276/1",
      );
      expect(card.buttons.map((button) => button.text)).not.toContain(
        "Навигация по группе",
      );
      expect(card.buttons.map((button) => button.text)).not.toContain(
        "Открыть группу",
      );
    },
  );

  it("keeps another product's materials and group separate", () => {
    const card = productCard(
      {
        ...product,
        slug: "another-course",
        programmeUrl: "https://sachkov.dev/products/another-course/programme",
      },
      { kind: "member" },
      "https://t.me/c/4421726276/1",
    );
    expect(card.buttons.map((button) => button.text)).not.toContain(
      "С чего начать",
    );
    expect(card.buttons.map((button) => button.text)).not.toContain(
      "Навигация по группе",
    );
    expect(card.buttons).toContainEqual({
      text: "Открыть курс",
      url: "https://sachkov.dev/products/another-course/programme",
    });
  });

  it("does not guess a topic in another canonical group", () => {
    expect(
      productCard(
        product,
        { kind: "member" },
        "https://t.me/c/1234567890/1",
      ).buttons.map((button) => button.text),
    ).not.toContain("Навигация по группе");
  });

  it.each(["expired", "revoked", "unavailable"] as const)(
    "hides lesson shortcuts when materials are %s",
    (state) => {
      expect(
        productCard(
          { ...product, materials: { state } },
          { kind: "none" },
        ).buttons.map((button) => button.text),
      ).not.toContain("С чего начать");
    },
  );
});
