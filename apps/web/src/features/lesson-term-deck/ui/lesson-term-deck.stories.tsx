import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { courseGlossaryHref } from "@/shared/routing/subscription-route";
import { expectPhoneLayout } from "@/storybook/phone-layout";

import { LessonTermDeck } from "./lesson-term-deck.client";

const terms = [
  {
    id: "bounded-context",
    title: "Ограниченный контекст",
    englishTitle: "Bounded context",
    shortDefinition: "Граница, внутри которой у слов модели один смысл.",
    fullDefinition: "Часть системы со своей моделью и своим языком.",
  },
  {
    id: "aggregate",
    title: "Агрегат",
    englishTitle: null,
    shortDefinition: "Группа объектов, которая меняется как одно целое.",
    fullDefinition: "Граница согласованности изменений.",
  },
];

const meta = {
  id: "features-lesson-term-deck",
  title: "Components/Material/Lesson term deck",
  component: LessonTermDeck,
  args: {
    terms,
    onMark: fn(),
    courseGlossaryHref: courseGlossaryHref("ddd"),
    marking: {
      kind: "ready",
      marks: new Map(),
      savingTermId: null,
      failed: false,
    },
  },
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Колода «Термины урока» в конце урока (#2127): термин на лицевой стороне, короткое определение на обороте, отметки «знаю» и «повторить» сохраняются за вошедшим. Отметки поставляет production adapter `SavedLessonTermDeck`.",
      },
    },
  },
} satisfies Meta<typeof LessonTermDeck>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The card that faces the reader: one button, named by its visible side. */
function card(canvasElement: HTMLElement) {
  const deck = canvasElement.querySelector<HTMLElement>(
    "[data-lesson-term-card]",
  );
  if (deck === null) throw new Error("The deck shows no card");
  return deck;
}

/** Opens the collapsed «Термины урока · N» row. */
async function open(canvasElement: HTMLElement) {
  const row = within(canvasElement).getByRole("button", {
    name: /^Термины урока · 2$/u,
  });
  await userEvent.click(row);
  await expect(row).toHaveAttribute("aria-expanded", "true");
}

/** The finish card shows the deck as one row; the cards stay closed until the reader opens it. */
export const Collapsed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("button", { name: /^Термины урока · 2$/u });
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("button", { name: "Знаю" })).toBeNull();
    row.focus();
    await userEvent.keyboard("{Enter}");
    await expect(row).toHaveAttribute("aria-expanded", "true");
    await expect(
      canvas.getByRole("region", { name: "Термины урока" }),
    ).toBeVisible();
    await userEvent.click(row);
    await expect(row).toHaveAttribute("aria-expanded", "false");
  },
};

export const MarkAndAdvance: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await open(canvasElement);
    await expect(canvas.getByText("1 из 2")).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", {
        name: /^Ограниченный контекст.*Показать определение$/u,
      }),
    );
    await expect(card(canvasElement)).toHaveAttribute(
      "data-lesson-term-side",
      "back",
    );
    await expect(
      canvas.getByRole("button", {
        name: /Граница, внутри которой у слов модели один смысл\..*Показать термин/u,
      }),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Повторить" }));
    await expect(args.onMark).toHaveBeenCalledWith("bounded-context", "review");
    // After a mark the deck turns to the next term, front side up.
    await expect(canvas.getByText("2 из 2")).toBeVisible();
    await expect(card(canvasElement)).toHaveAttribute(
      "data-lesson-term-side",
      "front",
    );
    await expect(
      canvas.getByRole("button", { name: /^Агрегат/u }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "Все термины курса" }),
    ).toHaveAttribute("href", "/products/ddd/glossary");
    // The deck has no separate arrows: the big buttons move it on.
    await expect(
      canvas.queryByRole("button", { name: "Следующий термин" }),
    ).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Знаю" }));
    await expect(args.onMark).toHaveBeenLastCalledWith("aggregate", "known");
    await expect(canvas.getByText("Колода пройдена")).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Пройти ещё раз" }),
    );
    await expect(canvas.getByText("1 из 2")).toBeVisible();
  },
};

/** The card turns with the keyboard too: Tab reaches it, Enter and Space turn it over. */
export const FlipWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await open(canvasElement);
    const turnable = canvas.getByRole("button", { name: /^Ограниченный/u });
    turnable.focus();
    await userEvent.keyboard("{Enter}");
    await expect(card(canvasElement)).toHaveAttribute(
      "data-lesson-term-side",
      "back",
    );
    await userEvent.keyboard(" ");
    await expect(card(canvasElement)).toHaveAttribute(
      "data-lesson-term-side",
      "front",
    );
  },
};

export const Marked: Story = {
  args: {
    marking: {
      kind: "ready",
      marks: new Map([
        ["bounded-context", "known"],
        ["aggregate", "review"],
      ] as const),
      savingTermId: null,
      failed: false,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await open(canvasElement);
    await expect(canvas.getByRole("button", { name: "Знаю" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Знаю: 1, повторить: 1",
    );
  },
};

/** A guest leafs through the deck without marks and is asked to sign in to keep them. */
export const Guest: Story = {
  args: { marking: { kind: "guest", loginHref: "/account" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await open(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Знаю" })).toBeNull();
    await expect(canvas.getByRole("link", { name: "Войдите" })).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Следующий термин" }),
    );
    await expect(canvas.getByText("2 из 2")).toBeVisible();
  },
};

export const SaveFailed: Story = {
  args: {
    marking: {
      kind: "ready",
      marks: new Map(),
      savingTermId: null,
      failed: true,
    },
  },
  play: async ({ canvasElement }) => {
    await open(canvasElement);
  },
};

export const OutsideCourse: Story = {
  args: { courseGlossaryHref: undefined },
  play: async ({ canvasElement }) => {
    await open(canvasElement);
    await expect(
      within(canvasElement).queryByRole("link", { name: "Все термины курса" }),
    ).toBeNull();
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile320", isRotated: false } },
  play: async ({ canvasElement }) => {
    await open(canvasElement);
    await expectPhoneLayout(canvasElement, "[data-lesson-term-deck]");
  },
};

export const Phone390: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    await open(canvasElement);
    await expectPhoneLayout(canvasElement, "[data-lesson-term-deck]");
  },
};
