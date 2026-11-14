import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

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
  args: { terms },
  // As wide as the lesson column.
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "«Термины урока» (решения владельца 14.11.2026): свой всегда открытый блок в конце урока перед карточкой «Финиш урока». Карточки листаются свайпом, мышью (нажать и тянуть), стрелками или клавишами ← и →, следующая выглядывает справа. Нажатие, Enter или пробел переворачивают карточку: термин на лицевой стороне, короткое определение на обороте. Значок поворота и тихая подсказка показывают, что карточку можно перевернуть. Отметок, счётчиков и ссылок нет.",
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

function track(canvasElement: HTMLElement) {
  const found = canvasElement.querySelector<HTMLElement>(
    "[data-lesson-term-track]",
  );
  if (found === null) throw new Error("The carousel has no track");
  return found;
}

/** One mouse pointer event at `clientX`, the way a browser sends it. */
function mouse(type: string, target: HTMLElement, clientX: number) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX,
      clientY: 100,
    }),
  );
}

/**
 * The carousel stands open under a quiet heading: only cards, no marks, counters, completion or
 * links. A click turns a card; the next card peeks out at the right edge.
 */
export const FlipAndLeaf: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const carousel = canvas.getByRole("region", { name: "Термины урока" });
    await expect(carousel).toHaveAttribute("aria-roledescription", "карусель");
    await expect(
      canvas.getByRole("heading", { name: "Термины урока" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: /^Термины урока/u }),
    ).toBeNull();
    for (const gone of ["Знаю", "Повторить", "Пройти ещё раз"])
      await expect(canvas.queryByRole("button", { name: gone })).toBeNull();
    await expect(canvas.queryByRole("link")).toBeNull();
    await expect(canvas.queryByText(/из 3/u)).toBeNull();
    const slides = canvas.getAllByRole("group");
    await expect(slides).toHaveLength(3);
    await expect(slides[0]).toHaveAttribute("aria-roledescription", "слайд");
    await expect(slides[0]).toHaveAccessibleName("1 из 3");

    // The second card peeks out: it starts inside the carousel and runs past its edge.
    const edge = track(canvasElement).getBoundingClientRect().right;
    const second = slides[1];
    if (second === undefined) throw new Error("The carousel has one card");
    await expect(second.getBoundingClientRect().left).toBeLessThan(edge);
    await expect(second.getBoundingClientRect().right).toBeGreaterThan(edge);

    // The cards lie on an opaque sand block; only the edge with more cards fades.
    await expect(getComputedStyle(carousel).backgroundColor).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
    await expect(track(canvasElement)).toHaveAttribute("data-more-after");
    await expect(track(canvasElement)).not.toHaveAttribute("data-more-before");

    // The front says it turns over; the hint is not part of the card's name.
    const [hint] = canvas.getAllByText("Нажмите, чтобы увидеть определение");
    await expect(hint).toBeVisible();
    const first = card(canvasElement, "bounded-context");
    await expect(first).toHaveAccessibleName(
      "Ограниченный контекст Bounded context",
    );
    await userEvent.click(first);
    await expect(first).toHaveAttribute("data-lesson-term-side", "back");
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
      expect(track(canvasElement)).toHaveAttribute("data-more-before"),
    );
    await waitFor(() =>
      expect(
        canvasElement.querySelector("[data-lesson-term-announcement]"),
      ).toHaveTextContent("Агрегат, 2 из 3"),
    );
  },
};

/** A mouse drags the cards like a finger; the drag does not turn the card it started on. */
export const MouseDrag: Story = {
  play: async ({ canvasElement }) => {
    const first = card(canvasElement, "bounded-context");
    const rail = track(canvasElement);
    await expect(rail.scrollLeft).toBe(0);
    mouse("pointerdown", first, 400);
    mouse("pointermove", first, 380);
    mouse("pointermove", first, 250);
    await expect(rail).toHaveAttribute("data-dragging");
    await expect(rail.scrollLeft).toBeGreaterThan(100);
    mouse("pointerup", first, 250);
    // The browser clicks where the drag ended; that click must not turn the card.
    first.click();
    await expect(rail).not.toHaveAttribute("data-dragging");
    // The drag settles on the next card; by then a turn of the first card would have shown.
    await waitFor(() =>
      expect(card(canvasElement, "aggregate")).toHaveAttribute("tabindex", "0"),
    );
    await expect(first).toHaveAttribute("data-lesson-term-side", "front");

    // A press without travel is still a click that turns the card.
    const second = card(canvasElement, "aggregate");
    mouse("pointerdown", second, 300);
    mouse("pointermove", second, 302);
    mouse("pointerup", second, 302);
    second.click();
    await waitFor(() =>
      expect(second).toHaveAttribute("data-lesson-term-side", "back"),
    );
  },
};

/** ← and → move between cards; Enter and Space turn the focused card over. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
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
    // At the end only the start edge fades: no cards wait after the last one.
    await waitFor(() =>
      expect(track(canvasElement)).not.toHaveAttribute("data-more-after"),
    );
    await expect(track(canvasElement)).toHaveAttribute("data-more-before");
    await userEvent.keyboard("{ArrowLeft}");
    await expect(second).toHaveFocus();
  },
};

/** Cards that all fit need no arrows. */
export const SingleTerm: Story = {
  args: { terms: terms.slice(0, 1) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("region", { name: "Термины урока" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("button", { name: "Следующий термин" }),
    ).toBeNull();
    await expect(track(canvasElement)).not.toHaveAttribute("data-more-after");
    await expect(track(canvasElement)).not.toHaveAttribute("data-more-before");
  },
};

/** A lesson without new terms has no block at all. */
export const NoTerms: Story = {
  args: { terms: [] },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector("[data-lesson-term-deck]"),
    ).toBeNull();
  },
};

export const Phone360: Story = {
  globals: { viewport: { value: "mobile360", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expectPhoneLayout(canvasElement, "[data-lesson-term-deck]");
  },
};

export const Phone390: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expectPhoneLayout(canvasElement, "[data-lesson-term-deck]");
  },
};
