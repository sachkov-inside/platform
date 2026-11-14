import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

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
  {
    id: "domain-event",
    title: "Доменное событие",
    englishTitle: "Domain event",
    shortDefinition: "Факт предметной области, который уже произошёл.",
    fullDefinition: "Запись о значимом изменении в модели.",
  },
];

const meta = {
  id: "features-lesson-term-deck",
  title: "Components/Material/Lesson term deck",
  component: LessonTermDeck,
  args: {
    terms,
    courseGlossaryHref: courseGlossaryHref("ddd"),
  },
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "«Термины урока» в конце урока (решение владельца 14.11.2026): строка раскрывает карусель карточек. Свайп, стрелки или клавиши ← и → листают карточки, следующая выглядывает справа; нажатие, Enter или пробел переворачивают карточку: термин на лицевой стороне, короткое определение на обороте. Отметок и состояния «пройдено» нет.",
      },
    },
  },
} satisfies Meta<typeof LessonTermDeck>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The card of one term: a button named by its visible side. */
function card(canvasElement: HTMLElement, termId: string) {
  const found = canvasElement.querySelector<HTMLElement>(
    `[data-lesson-term-card="${termId}"]`,
  );
  if (found === null) throw new Error(`The carousel shows no card ${termId}`);
  return found;
}

/** Opens the collapsed «Термины урока · N» row. */
async function open(canvasElement: HTMLElement) {
  const row = within(canvasElement).getByRole("button", {
    name: /^Термины урока · 3$/u,
  });
  await userEvent.click(row);
  await expect(row).toHaveAttribute("aria-expanded", "true");
}

/** The finish card shows the terms as one row; the cards stay closed until the reader opens it. */
export const Collapsed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("button", { name: /^Термины урока · 3$/u });
    await expect(row).toHaveAttribute("aria-expanded", "false");
    await expect(
      canvasElement.querySelector("[data-lesson-term-card]"),
    ).toBeNull();
    row.focus();
    await userEvent.keyboard("{Enter}");
    await expect(row).toHaveAttribute("aria-expanded", "true");
    const carousel = canvas.getByRole("region", { name: "Термины урока" });
    await expect(carousel).toHaveAttribute("aria-roledescription", "карусель");
    await expect(carousel).toBeVisible();
    await userEvent.click(row);
    await expect(row).toHaveAttribute("aria-expanded", "false");
  },
};

/**
 * Only cards: no marks, counters, completion or captions. A click turns a card; the next card
 * peeks out at the right edge.
 */
export const FlipAndLeaf: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await open(canvasElement);
    for (const gone of ["Знаю", "Повторить", "Пройти ещё раз"])
      await expect(canvas.queryByRole("button", { name: gone })).toBeNull();
    await expect(canvas.queryByText(/из 3/u)).toBeNull();
    await expect(canvas.queryByText("Колода пройдена")).toBeNull();
    const slides = canvas.getAllByRole("group");
    await expect(slides).toHaveLength(3);
    await expect(slides[0]).toHaveAttribute("aria-roledescription", "слайд");
    await expect(slides[0]).toHaveAccessibleName("1 из 3");

    // The second card peeks out: it starts inside the carousel and runs past its edge.
    const track = slides[0]?.parentElement;
    const second = slides[1];
    if (track === null || track === undefined || second === undefined)
      throw new Error("The carousel has no track");
    const edge = track.getBoundingClientRect().right;
    await expect(second.getBoundingClientRect().left).toBeLessThan(edge);
    await expect(second.getBoundingClientRect().right).toBeGreaterThan(edge);

    await userEvent.click(
      canvas.getByRole("button", { name: /^Ограниченный контекст/u }),
    );
    await expect(card(canvasElement, "bounded-context")).toHaveAttribute(
      "data-lesson-term-side",
      "back",
    );
    await expect(
      canvas.getByRole("button", {
        name: "Граница, внутри которой у слов модели один смысл.",
      }),
    ).toBeVisible();

    const previous = canvas.getByRole("button", { name: "Предыдущий термин" });
    const next = canvas.getByRole("button", { name: "Следующий термин" });
    await expect(previous).toBeDisabled();
    await userEvent.click(next);
    await waitFor(() =>
      expect(card(canvasElement, "aggregate")).toHaveAttribute("tabindex", "0"),
    );
    await expect(previous).toBeEnabled();
    await waitFor(() =>
      expect(
        canvasElement.querySelector("[data-lesson-term-announcement]"),
      ).toHaveTextContent("Агрегат, 2 из 3"),
    );
    await expect(
      canvas.getByRole("link", { name: "Все термины курса" }),
    ).toHaveAttribute("href", "/products/ddd/glossary");
  },
};

/** ← and → move between cards; Enter and Space turn the focused card over. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    await open(canvasElement);
    const first = card(canvasElement, "bounded-context");
    await expect(first).toHaveAttribute("tabindex", "0");
    await expect(card(canvasElement, "aggregate")).toHaveAttribute(
      "tabindex",
      "-1",
    );
    first.focus();
    await userEvent.keyboard("{Enter}");
    await expect(first).toHaveAttribute("data-lesson-term-side", "back");
    await userEvent.keyboard(" ");
    await expect(first).toHaveAttribute("data-lesson-term-side", "front");

    await userEvent.keyboard("{ArrowRight}");
    const second = card(canvasElement, "aggregate");
    await expect(second).toHaveFocus();
    await waitFor(() => expect(second).toHaveAttribute("tabindex", "0"));
    await userEvent.keyboard(" ");
    await expect(second).toHaveAttribute("data-lesson-term-side", "back");
    await userEvent.keyboard("{End}");
    await expect(card(canvasElement, "domain-event")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(second).toHaveFocus();
  },
};

/** One term needs no arrows. */
export const SingleTerm: Story = {
  args: { terms: terms.slice(0, 1) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: /^Термины урока · 1$/u }),
    );
    await expect(
      canvas.queryByRole("button", { name: "Следующий термин" }),
    ).toBeNull();
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

export const Phone360: Story = {
  globals: { viewport: { value: "mobile360", isRotated: false } },
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
