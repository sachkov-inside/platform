import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { courseGlossaryHref } from "@/shared/routing/subscription-route";

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

export const MarkAndAdvance: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Термины урока" }),
    ).toBeVisible();
    await expect(canvas.getByText("1 из 2")).toBeVisible();
    await expect(canvas.getByText("Ограниченный контекст")).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Показать определение" }),
    );
    await expect(
      canvas.getByText("Граница, внутри которой у слов модели один смысл."),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Повторить" }));
    await expect(args.onMark).toHaveBeenCalledWith("bounded-context", "review");
    // After a mark the deck turns to the next term, front side up.
    await expect(canvas.getByText("2 из 2")).toBeVisible();
    await expect(canvas.getByText("Агрегат")).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "Все термины курса" }),
    ).toHaveAttribute("href", "/products/ddd/glossary");
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
    await expect(canvas.getByRole("button", { name: "Знаю" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Знаю: 1, повторить: 1",
    );
  },
};

export const Guest: Story = {
  args: { marking: { kind: "guest", loginHref: "/account" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Знаю" })).toBeNull();
    await expect(canvas.getByRole("link", { name: "Войдите" })).toBeVisible();
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
};

export const OutsideCourse: Story = {
  args: { courseGlossaryHref: undefined },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile320", isRotated: false } },
};
