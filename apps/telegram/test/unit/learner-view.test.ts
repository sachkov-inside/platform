import { describe, expect, it } from "vitest";
import {
  productCard,
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
