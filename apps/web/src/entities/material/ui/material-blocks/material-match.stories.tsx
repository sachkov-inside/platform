import { expectCalmDisabledCheck } from "@/storybook/exercise-actions";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import {
  ExerciseAnswersProvider,
  type ExerciseAnswerRecord,
  type ExerciseAnswerState,
} from "../../model/exercise-answers.client";
import { expectPhoneLayout } from "@/storybook/phone-layout";
import { chooseInSelect, selectClosed } from "@/storybook/select-choice";
import { MaterialMatch } from "./material-match-order.client";

const meta = {
  id: "entities-material-match",
  title: "Components/Material/Match",
  component: MaterialMatch,
  args: {
    id: "rag-stages",
    heading: "Упражнение 1 из 3",
    mode: "pairs",
    question: "Сопоставь этап RAG с тем, что на нём происходит.",
    rows: [
      {
        id: "chunk",
        content: "Нарезка документов на чанки",
        answerId: "index",
        explanation: "Чанки готовят заранее, при индексации.",
      },
      {
        id: "search",
        content: "Поиск ближайших чанков к вопросу",
        answerId: "retrieve",
        explanation: "Поиск идёт на каждый вопрос пользователя.",
      },
      {
        id: "prompt",
        content: "Вставка найденного текста в промпт",
        answerId: "generate",
        explanation: "Модель видит найденное только в промпте.",
      },
    ],
    choices: [
      { id: "generate", label: "Генерация ответа" },
      { id: "index", label: "Индексация" },
      { id: "retrieve", label: "Извлечение" },
    ],
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MaterialMatch>;
export default meta;
type Story = StoryObj<typeof meta>;

const correct = ["Индексация", "Извлечение", "Генерация ответа"];

/** The drop-down list opens in a layer over the page, outside the story's canvas. */
function page(element: HTMLElement) {
  return within(element.ownerDocument.body);
}

const choose = chooseInSelect;

/** The colour of every row after a check, read from its `data-result`. */
function rowResults(canvasElement: HTMLElement): readonly (string | null)[] {
  return [
    ...canvasElement.querySelectorAll<HTMLElement>("[data-match-row]"),
  ].map((row) => row.getAttribute("data-result"));
}

/** The plain answer a checked row shows in place of its list. */
function rowChoices(canvasElement: HTMLElement): readonly string[] {
  return [
    ...canvasElement.querySelectorAll<HTMLElement>(
      "[data-match-row] [data-match-choice]",
    ),
  ].map((choice) => choice.textContent);
}

/** The quiet «→ answer» lines of wrong rows, as a screen reader hears them. */
function rightAnswers(canvasElement: HTMLElement): readonly string[] {
  return [
    ...canvasElement.querySelectorAll<HTMLElement>("[data-item-review] > p"),
  ].map((line) => line.textContent);
}

async function pick(canvasElement: HTMLElement, labels: readonly string[]) {
  const match = within(canvasElement);
  const selects = match.getAllByRole("combobox");
  for (const [index, label] of labels.entries()) {
    const select = selects[index];
    if (select === undefined) throw new Error("Missing row");
    await choose(select, label);
  }
}

/** Every row has its own drop-down list; «Проверить» waits for all of them. */
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const match = within(canvasElement);
    await expect(match.getAllByRole("combobox")).toHaveLength(3);
    await expect(
      match.getByRole("combobox", { name: /Нарезка документов на чанки/u }),
    ).toHaveTextContent("Выбери ответ");
    await expectCalmDisabledCheck(
      match.getByRole("button", { name: "Проверить" }),
    );
    await pick(canvasElement, correct.slice(0, 2));
    await expect(
      match.getByRole("button", { name: "Проверить" }),
    ).toBeDisabled();
    await expect(
      match.queryByText("Чанки готовят заранее, при индексации."),
    ).toBeNull();
  },
};

export const Correct: Story = {
  play: async ({ canvasElement }) => {
    const match = within(canvasElement);
    await pick(canvasElement, correct);
    await userEvent.click(match.getByRole("button", { name: "Проверить" }));
    await expect(match.getByText("Правильно", { exact: true })).toBeVisible();
    await expect(rowResults(canvasElement)).toEqual([
      "correct",
      "correct",
      "correct",
    ]);
    // The explanation is folded under «Почему» and opens with a click.
    const explanation = match.getByText(
      "Чанки готовят заранее, при индексации.",
    );
    await expect(explanation).not.toBeVisible();
    const why = match.getAllByText("Почему", { exact: true })[0];
    if (why === undefined) throw new Error("Missing «Почему»");
    await userEvent.click(why);
    await expect(explanation).toBeVisible();
    await expect(rightAnswers(canvasElement)).toEqual([]);
  },
};

/** Each row turns green or red and folds its explanation; a wrong row names the right answer. */
export const PartlyWrong: Story = {
  play: async ({ canvasElement }) => {
    const match = within(canvasElement);
    await pick(canvasElement, ["Извлечение", "Индексация", "Генерация ответа"]);
    await userEvent.click(match.getByRole("button", { name: "Проверить" }));
    await expect(
      match.getByText("Пока неверно: 1 из 3", { exact: true }),
    ).toBeVisible();
    await expect(rowResults(canvasElement)).toEqual([
      "incorrect",
      "incorrect",
      "correct",
    ]);
    await expect(rightAnswers(canvasElement)).toEqual([
      "→ Верный ответ: Индексация",
      "→ Верный ответ: Извлечение",
    ]);
    await expect(
      match.queryByText(/^Неверно$/u, { ignore: ".sr-only" }),
    ).toBeNull();
    // A checked row shows the chosen answer as plain text, not a list.
    await expect(match.queryAllByRole("combobox")).toHaveLength(0);
    await expect(rowChoices(canvasElement)).toEqual([
      "Ответ: Извлечение",
      "Ответ: Индексация",
      "Ответ: Генерация ответа",
    ]);
  },
};

/** Whether a row's list offers the answer: opens the list, reads the item, closes the list. */
async function offers(select: HTMLElement, label: string): Promise<boolean> {
  await userEvent.click(select);
  const item = await page(select).findByRole("option", { name: label });
  const enabled = item.getAttribute("aria-disabled") !== "true";
  await userEvent.keyboard("{Escape}");
  await selectClosed(select);
  return enabled;
}

/** Pairs are one to one: a choice taken by one row is unavailable in the others until freed. */
export const OneToOne: Story = {
  play: async ({ canvasElement }) => {
    const match = within(canvasElement);
    const [first, second, third] = match.getAllByRole("combobox");
    if (first === undefined || second === undefined || third === undefined)
      throw new Error("Missing row");
    await choose(first, "Индексация");
    await expect(await offers(first, "Индексация")).toBe(true);
    await expect(await offers(second, "Индексация")).toBe(false);
    await expect(await offers(third, "Индексация")).toBe(false);
    await expect(await offers(second, "Извлечение")).toBe(true);
    await choose(first, "Извлечение");
    await expect(await offers(second, "Индексация")).toBe(true);
    await expect(await offers(second, "Извлечение")).toBe(false);
  },
};

/** «Начать заново» empties every list and hides the verdicts; nothing else on the page changes. */
export const StartOver: Story = {
  play: async ({ canvasElement }) => {
    const match = within(canvasElement);
    await pick(canvasElement, ["Извлечение", "Генерация ответа", "Индексация"]);
    await userEvent.click(match.getByRole("button", { name: "Проверить" }));
    await expect(
      match.getByText("Пока неверно: 0 из 3", { exact: true }),
    ).toBeVisible();
    await userEvent.click(match.getByRole("button", { name: "Начать заново" }));
    await expect(match.queryByText(/Пока неверно/u)).toBeNull();
    await expect(
      match.queryByText("Чанки готовят заранее, при индексации."),
    ).toBeNull();
    for (const select of match.getAllByRole("combobox")) {
      await expect(select).toBeEnabled();
      await expect(select).toHaveTextContent("Выбери ответ");
    }
    await pick(canvasElement, correct);
    await userEvent.click(match.getByRole("button", { name: "Проверить" }));
    await expect(match.getByText("Правильно", { exact: true })).toBeVisible();
  },
};

/** Groups: several rows share one answer; 2-3 groups. */
export const Groups: Story = {
  args: {
    id: "where-it-runs",
    mode: "groups",
    question: "Разложи действия по месту, где они выполняются.",
    rows: [
      {
        id: "split",
        content: "Нарезать документы",
        answerId: "offline",
        explanation: "Это делается один раз до запросов.",
      },
      {
        id: "embed-docs",
        content: "Посчитать эмбеддинги документов",
        answerId: "offline",
        explanation: "Документы не меняются от вопроса к вопросу.",
      },
      {
        id: "embed-question",
        content: "Посчитать эмбеддинг вопроса",
        answerId: "online",
        explanation: "Вопрос появляется только в момент запроса.",
      },
      {
        id: "search",
        content: "Найти похожие чанки",
        answerId: "online",
        explanation: "Поиск идёт по каждому вопросу.",
      },
    ],
    choices: [
      { id: "offline", label: "Заранее, при индексации" },
      { id: "online", label: "На каждый запрос" },
    ],
  },
  play: async ({ canvasElement }) => {
    const match = within(canvasElement);
    await expect(match.queryByText(/Выбери группу/u)).toBeNull();
    const [first, second] = match.getAllByRole("combobox");
    if (first === undefined || second === undefined)
      throw new Error("Missing row");
    await choose(first, "Заранее, при индексации");
    await expect(await offers(second, "Заранее, при индексации")).toBe(true);
    await pick(canvasElement, [
      "Заранее, при индексации",
      "Заранее, при индексации",
      "На каждый запрос",
      "Заранее, при индексации",
    ]);
    await userEvent.click(match.getByRole("button", { name: "Проверить" }));
    await expect(
      match.getByText("Пока неверно: 3 из 4", { exact: true }),
    ).toBeVisible();
    await expect(rowResults(canvasElement)).toEqual([
      "correct",
      "correct",
      "correct",
      "incorrect",
    ]);
    await expect(rightAnswers(canvasElement)).toEqual([
      "→ Верный ответ: На каждый запрос",
    ]);
    await expect(
      match.getByText("Поиск идёт по каждому вопросу."),
    ).not.toBeVisible();
  },
};

export const DontKnow: Story = {
  args: {
    dontKnow: {
      explanation: "Вспомни, что из этого происходит до вопроса пользователя.",
      reviewLinks: ["#этапы-rag"],
    },
  },
  play: async ({ canvasElement }) => {
    const match = within(canvasElement);
    await userEvent.click(match.getByRole("button", { name: "Не знаю" }));
    await expect(match.getByText("Не знаю · без оценки")).toBeVisible();
    // The key shows in each row, tinted as an answer not given; nothing reads as wrong.
    await expect(rowResults(canvasElement)).toEqual([
      "missed",
      "missed",
      "missed",
    ]);
    await expect(rowChoices(canvasElement)).toEqual([
      "Верный ответ: Индексация",
      "Верный ответ: Извлечение",
      "Верный ответ: Генерация ответа",
    ]);
    await expect(match.queryByText("Неверно", { exact: true })).toBeNull();
    await expect(
      match.getByRole("link", { name: "Повторить раздел" }),
    ).toHaveAttribute("href", "#этапы-rag");
  },
};

/** The answer source receives `matches` and gives back a past answer to an older version. */
function useRecordedAnswer(): ExerciseAnswerState {
  const [current, setCurrent] = useState<ExerciseAnswerRecord | null>({
    answer: {
      kind: "matches",
      matches: [
        { rowId: "chunk", choiceId: "index" },
        { rowId: "search", choiceId: "removed-choice" },
        { rowId: "prompt", choiceId: "generate" },
      ],
    },
    result: "incorrect",
  });
  return {
    current,
    updated: current !== null,
    note: "Войдите, чтобы ответы сохранялись в аккаунте.",
    answer: (record) => {
      canvasRecords.push(record);
      setCurrent(record);
    },
    retry: () => {
      setCurrent(null);
    },
  };
}
const canvasRecords: ExerciseAnswerRecord[] = [];

export const PastAnswer: Story = {
  decorators: [
    (Story) => (
      <ExerciseAnswersProvider source={useRecordedAnswer}>
        <Story />
      </ExerciseAnswersProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    canvasRecords.length = 0;
    const match = within(canvasElement);
    await expect(
      match.getByText("Упражнение обновлено, ответь ещё раз"),
    ).toBeVisible();
    // A choice removed in the new version reads as an empty answer.
    await expect(rowChoices(canvasElement)).toEqual([
      "Ответ: Индексация",
      "Ответ: Без ответа",
      "Ответ: Генерация ответа",
    ]);
    await expect(
      match.getByText("Пока неверно: 2 из 3", { exact: true }),
    ).toBeVisible();
    await userEvent.click(match.getByRole("button", { name: "Начать заново" }));
    await pick(canvasElement, correct);
    await userEvent.click(match.getByRole("button", { name: "Проверить" }));
    await expect(canvasRecords).toEqual([
      {
        answer: {
          kind: "matches",
          matches: [
            { rowId: "chunk", choiceId: "index" },
            { rowId: "search", choiceId: "retrieve" },
            { rowId: "prompt", choiceId: "generate" },
          ],
        },
        result: "correct",
      },
    ]);
  },
};

/** A 360 px phone with long rows and answers: no horizontal scroll, 44 px touch targets. */
export const Phone360: Story = {
  ...PartlyWrong,
  globals: { viewport: { value: "mobile360", isRotated: false } },
  args: {
    rows: [
      {
        id: "chunk",
        content:
          "Нарезка длинных документов на чанки с перекрытием, чтобы мысль не обрывалась на границе",
        answerId: "index",
        explanation: "Чанки готовят заранее, при индексации.",
      },
      ...meta.args.rows.slice(1),
    ],
    choices: [
      { id: "generate", label: "Генерация ответа" },
      {
        id: "index",
        label: "Индексация базы знаний до первого вопроса пользователя",
      },
      { id: "retrieve", label: "Извлечение" },
    ],
  },
  play: async (context) => {
    const { canvasElement } = context;
    const match = within(canvasElement);
    await expect(window.innerWidth).toBe(360);
    await pick(canvasElement, [
      "Извлечение",
      "Индексация базы знаний до первого вопроса пользователя",
      "Генерация ответа",
    ]);
    await expectPhoneLayout(canvasElement, "[data-match-row]");
    await userEvent.click(match.getByRole("button", { name: "Проверить" }));
    await expect(match.getByText(/Пока неверно/u)).toBeVisible();
    await expectPhoneLayout(canvasElement, "[data-match-row]");
  },
};

/** The list works from the keyboard: Enter opens it, arrows move, Enter picks. */
export const ChooseWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const match = within(canvasElement);
    const first = match.getByRole("combobox", { name: /Нарезка документов/u });
    first.focus();
    await userEvent.keyboard("{Enter}");
    await page(canvasElement).findByRole("listbox");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await selectClosed(first);
    await expect(first).not.toHaveTextContent("Выбери ответ");
    await expect(first).toHaveFocus();
  },
};

/**
 * On a phone the open list stays inside the screen. Its text keeps the lesson's 17 px reading size
 * (owner, 14.11.2026, variant 2A), above the 16 px a phone needs to skip zooming in.
 */
export const Phone360Open: Story = {
  ...Phone360,
  play: async ({ canvasElement }) => {
    const match = within(canvasElement);
    const [, second] = match.getAllByRole("combobox");
    if (second === undefined) throw new Error("Missing row");
    await expect(getComputedStyle(second).fontSize).toBe("17px");
    await userEvent.click(second);
    const list = await page(canvasElement).findByRole("listbox");
    const box = list.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    const item = await page(canvasElement).findByRole("option", {
      name: /Индексация/u,
    });
    await expect(getComputedStyle(item).fontSize).toBe("17px");
    await expect(document.documentElement.scrollWidth).toBe(
      document.documentElement.clientWidth,
    );
    // Closed again, so the page under the list is back for the accessibility check.
    await userEvent.keyboard("{Escape}");
    await selectClosed(second);
  },
};
