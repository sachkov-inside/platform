import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { useState } from "react";
import {
  ExerciseAnswersProvider,
  type ExerciseAnswerRecord,
  type ExerciseAnswerState,
} from "../../model/exercise-answers.client";
import { expectPhoneLayout } from "@/storybook/phone-layout";
import { MaterialOrder } from "./material-match-order.client";

const steps = [
  {
    id: "split",
    label: "Нарезать документы на чанки",
    explanation: "Без чанков нечего индексировать.",
  },
  {
    id: "embed",
    label: "Посчитать эмбеддинги чанков",
    explanation: "Эмбеддинги считают по готовым чанкам.",
  },
  {
    id: "store",
    label: "Сохранить векторы в индекс",
    explanation: "Индекс хранит уже посчитанные векторы.",
  },
  {
    id: "search",
    label: "Найти ближайшие чанки к вопросу",
    explanation: "Поиск идёт по заполненному индексу.",
  },
];

const meta = {
  id: "entities-material-order",
  title: "Components/Material/Order",
  component: MaterialOrder,
  args: {
    id: "rag-pipeline",
    heading: "Упражнение 2 из 3",
    question: "Расставь шаги RAG по порядку.",
    steps: steps.map((step) => ({ ...step, content: step.label })),
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MaterialOrder>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Step texts in the order the page shows them. */
function shownOrder(canvasElement: HTMLElement): string[] {
  return [
    ...canvasElement.querySelectorAll<HTMLElement>("[data-order-step]"),
  ].map(
    (step) =>
      steps.find((item) => step.textContent.includes(item.label))?.id ?? "",
  );
}

/** The colour of every step after a check, read from its `data-result`. */
function stepResults(canvasElement: HTMLElement): readonly (string | null)[] {
  return [
    ...canvasElement.querySelectorAll<HTMLElement>("[data-order-step]"),
  ].map((step) => step.getAttribute("data-result"));
}

/** Moves steps with «Выше» until the page shows them in the given order. */
async function arrange(canvasElement: HTMLElement, order: readonly string[]) {
  const exercise = within(canvasElement);
  for (const [target, id] of order.entries()) {
    const label = steps.find((step) => step.id === id)?.label ?? "";
    while (shownOrder(canvasElement).indexOf(id) > target)
      await userEvent.click(
        exercise.getByRole("button", { name: `Выше ${label}` }),
      );
  }
}

/** The shuffle of `rag-pipeline`, the order a fresh page starts from. */
const shownOrderBeforeAnswer = ["store", "embed", "split", "search"];

/** The page never shows the key: the steps start shuffled. */
export const Shuffled: Story = {
  play: async ({ canvasElement }) => {
    const exercise = within(canvasElement);
    await expect(shownOrder(canvasElement)).not.toEqual(
      steps.map((step) => step.id),
    );
    await expect(shownOrder(canvasElement)).toEqual(shownOrderBeforeAnswer);
    await expect(
      exercise.queryByText("Без чанков нечего индексировать."),
    ).toBeNull();
    await expect(
      exercise.getByRole("button", { name: "Проверить" }),
    ).toBeEnabled();
    await expect(exercise.queryByText(/Перетащи шаги/u)).toBeNull();
  },
};

/** «Выше / Ниже» move a step; the edge button is off and each move is announced. */
export const MoveWithButtons: Story = {
  play: async ({ canvasElement }) => {
    const exercise = within(canvasElement);
    const first = shownOrder(canvasElement)[0] ?? "";
    const label = steps.find((step) => step.id === first)?.label ?? "";
    await expect(
      exercise.getByRole("button", { name: `Выше ${label}` }),
    ).toBeDisabled();
    await userEvent.click(
      exercise.getByRole("button", { name: `Ниже ${label}` }),
    );
    await expect(shownOrder(canvasElement)[1]).toBe(first);
    await expect(
      canvasElement.querySelector("[data-order-announcement]"),
    ).toHaveTextContent(`«${label}»: место 2 из 4`);
    await expect(
      exercise.getByRole("button", { name: `Ниже ${label}` }),
    ).toHaveFocus();
  },
};

/** Keyboard only: Tab to a step's button, Enter moves it, Alt + ↑ / ↓ moves the focused step. */
export const MoveWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const exercise = within(canvasElement);
    const order = shownOrder(canvasElement);
    const last = order[3] ?? "";
    const label = steps.find((step) => step.id === last)?.label ?? "";
    const moves =
      canvasElement.querySelectorAll<HTMLElement>("[data-order-moves]")[3];
    if (moves === undefined) throw new Error("Missing buttons");
    // With a mouse the buttons stay quiet until the step is hovered or holds the focus.
    if (matchMedia("(hover: hover)").matches)
      await expect(getComputedStyle(moves).opacity).toBe("0");
    exercise.getByRole("button", { name: `Выше ${label}` }).focus();
    await waitFor(() => expect(getComputedStyle(moves).opacity).toBe("1"));
    await userEvent.keyboard("{Enter}");
    await expect(shownOrder(canvasElement)[2]).toBe(last);
    await userEvent.keyboard("{Alt>}{ArrowUp}{ArrowUp}{/Alt}");
    await expect(shownOrder(canvasElement)[0]).toBe(last);
    // At the top «Выше» is off, so the focus moves to «Ниже» of the same step.
    await expect(
      exercise.getByRole("button", { name: `Ниже ${label}` }),
    ).toHaveFocus();
    await expect(
      canvasElement.querySelector("[data-order-announcement]"),
    ).toHaveTextContent(`«${label}»: место 1 из 4`);
  },
};

/** Pointer events of one drag, as a mouse or a finger sends them. */
function pointer(type: string, clientY: number, pointerType: string) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: 20,
    clientY,
    isPrimary: true,
    pointerId: 1,
    pointerType,
  });
}

/**
 * Drags the step at `from` by its handle until its middle passes the middle of the step at `to`,
 * checking the drop line on the way.
 */
async function drag(
  canvasElement: HTMLElement,
  from: number,
  to: number,
  pointerType = "mouse",
) {
  const items = [
    ...canvasElement.querySelectorAll<HTMLElement>("[data-order-step]"),
  ];
  const handle = items[from]?.querySelector<HTMLElement>("[data-order-handle]");
  const source = items[from]?.getBoundingClientRect();
  const target = items[to]?.getBoundingClientRect();
  if (handle === null || handle === undefined || !source || !target)
    throw new Error("Missing step");
  const startY = source.top + source.height / 2;
  const endY = target.top + target.height / 2 + (to > from ? 6 : -6);
  handle.dispatchEvent(pointer("pointerdown", startY, pointerType));
  window.dispatchEvent(
    pointer("pointermove", (startY + endY) / 2, pointerType),
  );
  window.dispatchEvent(pointer("pointermove", endY, pointerType));
  await waitFor(() =>
    expect(
      canvasElement.querySelector("[data-order-drop-line]"),
    ).not.toBeNull(),
  );
  await expect(items[from]).toHaveAttribute("data-dragging");
  window.dispatchEvent(pointer("pointerup", endY, pointerType));
  await waitFor(() =>
    expect(canvasElement.querySelector("[data-order-drop-line]")).toBeNull(),
  );
}

/** A step dragged by its handle lands where the line showed, and the move is announced. */
export const DragToReorder: Story = {
  play: async ({ canvasElement }) => {
    const before = shownOrder(canvasElement);
    const moved = before[0] ?? "";
    const label = steps.find((step) => step.id === moved)?.label ?? "";
    await drag(canvasElement, 0, 2);
    await expect(shownOrder(canvasElement)).toEqual([
      before[1],
      before[2],
      moved,
      before[3],
    ]);
    await expect(
      canvasElement.querySelector("[data-order-announcement]"),
    ).toHaveTextContent(`«${label}»: место 3 из 4`);
    await drag(canvasElement, 3, 0, "touch");
    await expect(shownOrder(canvasElement)[0]).toBe(before[3]);
  },
};

/** Dragging the correct order and checking it gives «Правильно»; the handles leave after checking. */
export const DragThenCheck: Story = {
  play: async ({ canvasElement }) => {
    const exercise = within(canvasElement);
    for (const [target, id] of steps.map((step) => step.id).entries()) {
      const from = shownOrder(canvasElement).indexOf(id);
      if (from !== target) await drag(canvasElement, from, target);
    }
    await expect(shownOrder(canvasElement)).toEqual(
      steps.map((step) => step.id),
    );
    await userEvent.click(exercise.getByRole("button", { name: "Проверить" }));
    await expect(
      exercise.getByText("Правильно", { exact: true }),
    ).toBeVisible();
    await expect(canvasElement.querySelector("[data-order-handle]")).toBeNull();
  },
};

/** On a 360 px phone a finger drags a step without horizontal scroll. */
export const DragOnPhone360: Story = {
  globals: { viewport: { value: "mobile360", isRotated: false } },
  play: async ({ canvasElement }) => {
    const before = shownOrder(canvasElement);
    await drag(canvasElement, 1, 3, "touch");
    await expect(shownOrder(canvasElement)[3]).toBe(before[1]);
    await expectPhoneLayout(canvasElement, "[data-order-step]");
  },
};

export const Correct: Story = {
  play: async ({ canvasElement }) => {
    const exercise = within(canvasElement);
    await arrange(
      canvasElement,
      steps.map((step) => step.id),
    );
    await userEvent.click(exercise.getByRole("button", { name: "Проверить" }));
    await expect(
      exercise.getByText("Правильно", { exact: true }),
    ).toBeVisible();
    await expect(stepResults(canvasElement)).toEqual(Array(4).fill("in-place"));
    await expect(
      exercise.getAllByText("На месте", { exact: true })[0],
    ).toHaveClass("sr-only");
    const explanation = exercise.getByText(
      "Поиск идёт по заполненному индексу.",
    );
    await expect(explanation).not.toBeVisible();
    const why = exercise.getAllByText("Почему", { exact: true })[3];
    if (why === undefined) throw new Error("Missing «Почему»");
    await userEvent.click(why);
    await expect(explanation).toBeVisible();
    await expect(exercise.queryByRole("button", { name: /^Выше/u })).toBeNull();
  },
};

/** Steps out of place turn red with the place they belong to; every step folds its explanation. */
export const OutOfPlace: Story = {
  play: async ({ canvasElement }) => {
    const exercise = within(canvasElement);
    await arrange(canvasElement, ["embed", "split", "store", "search"]);
    await userEvent.click(exercise.getByRole("button", { name: "Проверить" }));
    await expect(
      exercise.getByText("Пока неверно: на месте 2 из 4", { exact: true }),
    ).toBeVisible();
    await expect(stepResults(canvasElement)).toEqual([
      "out-of-place",
      "out-of-place",
      "in-place",
      "in-place",
    ]);
    // The right place is a small «→ 2» for the eye and a sentence for a screen reader.
    const places = [
      ...canvasElement.querySelectorAll<HTMLElement>("[data-order-place]"),
    ];
    await expect(places.map((place) => place.dataset["orderPlace"])).toEqual([
      "2",
      "1",
    ]);
    await expect(places[1]).toHaveTextContent(
      "→ 1Не на месте, место этого шага: 1",
    );
    await expect(
      exercise.queryByText("Не на месте", { exact: true }),
    ).toBeNull();
    for (const step of steps)
      await expect(exercise.getByText(step.explanation)).toBeInTheDocument();
  },
};

/** «Ответить ещё раз» keeps the reader's order, so only the marked steps need moving. */
export const AnswerAgain: Story = {
  play: async ({ canvasElement }) => {
    const exercise = within(canvasElement);
    await arrange(canvasElement, ["embed", "split", "store", "search"]);
    await userEvent.click(exercise.getByRole("button", { name: "Проверить" }));
    await userEvent.click(
      exercise.getByRole("button", { name: "Ответить ещё раз" }),
    );
    await expect(exercise.queryByText(/Пока неверно/u)).toBeNull();
    await expect(shownOrder(canvasElement)).toEqual([
      "embed",
      "split",
      "store",
      "search",
    ]);
    await userEvent.click(
      exercise.getByRole("button", {
        name: "Выше Нарезать документы на чанки",
      }),
    );
    await userEvent.click(exercise.getByRole("button", { name: "Проверить" }));
    await expect(
      exercise.getByText("Правильно", { exact: true }),
    ).toBeVisible();
  },
};

export const DontKnow: Story = {
  args: {
    dontKnow: {
      explanation: "Начни с того, что нужно сделать до первого вопроса.",
      reviewLinks: ["#индексация"],
    },
  },
  play: async ({ canvasElement }) => {
    const exercise = within(canvasElement);
    await userEvent.click(exercise.getByRole("button", { name: "Не знаю" }));
    await expect(exercise.getByText("Не знаю · без оценки")).toBeVisible();
    await expect(exercise.getByText("Верный порядок")).toBeVisible();
    await expect(stepResults(canvasElement)).toEqual(Array(4).fill(null));
    await expect(shownOrder(canvasElement)).toEqual(
      steps.map((step) => step.id),
    );
    await expect(exercise.queryByText("Не на месте")).toBeNull();
    // «Не знаю» showed the key; answering again starts from the shuffle, not from the key.
    const shuffled = shownOrderBeforeAnswer;
    await userEvent.click(
      exercise.getByRole("button", { name: "Ответить ещё раз" }),
    );
    await expect(shownOrder(canvasElement)).toEqual(shuffled);
  },
};

const records: ExerciseAnswerRecord[] = [];

/** A past answer from the source, naming a removed step; a new check reaches the source. */
function useRecordedAnswer(): ExerciseAnswerState {
  const [current, setCurrent] = useState<ExerciseAnswerRecord | null>({
    answer: {
      kind: "sequence",
      stepIds: ["store", "removed-step", "split", "embed"],
    },
    result: "incorrect",
  });
  return {
    current,
    updated: false,
    answer: (record) => {
      records.push(record);
      setCurrent(record);
    },
    retry: () => {
      setCurrent(null);
    },
  };
}

export const PastAnswer: Story = {
  decorators: [
    (Story) => (
      <ExerciseAnswersProvider source={useRecordedAnswer}>
        <Story />
      </ExerciseAnswersProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    records.length = 0;
    const exercise = within(canvasElement);
    await expect(shownOrder(canvasElement)).toEqual([
      "store",
      "split",
      "embed",
      "search",
    ]);
    await expect(
      exercise.getByText("Пока неверно: на месте 1 из 4", { exact: true }),
    ).toBeVisible();
    await userEvent.click(
      exercise.getByRole("button", { name: "Ответить ещё раз" }),
    );
    // The saved answer is where answering again starts, not a new shuffle.
    await expect(shownOrder(canvasElement)).toEqual([
      "store",
      "split",
      "embed",
      "search",
    ]);
    await arrange(
      canvasElement,
      steps.map((step) => step.id),
    );
    await userEvent.click(exercise.getByRole("button", { name: "Проверить" }));
    await expect(records).toEqual([
      {
        answer: {
          kind: "sequence",
          stepIds: ["split", "embed", "store", "search"],
        },
        result: "correct",
      },
    ]);
  },
};

/** A 360 px phone with long steps: no horizontal scroll, 44 px touch targets. */
export const Phone360: Story = {
  globals: { viewport: { value: "mobile360", isRotated: false } },
  args: {
    steps: steps.map((step, index) =>
      index === 0
        ? {
            ...step,
            content:
              "Нарезать длинные документы на чанки с перекрытием, чтобы мысль не обрывалась на границе соседних чанков",
          }
        : { ...step, content: step.label },
    ),
  },
  play: async ({ canvasElement }) => {
    const exercise = within(canvasElement);
    await expect(window.innerWidth).toBe(360);
    await expectPhoneLayout(canvasElement, "[data-order-step]");
    await userEvent.click(exercise.getByRole("button", { name: "Проверить" }));
    await expect(exercise.getByText(/Пока неверно/u)).toBeVisible();
    await expectPhoneLayout(canvasElement, "[data-order-step]");
  },
};
