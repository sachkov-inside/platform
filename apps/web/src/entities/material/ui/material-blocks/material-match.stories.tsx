import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import {
  ExerciseAnswersProvider,
  type ExerciseAnswerRecord,
  type ExerciseAnswerState,
} from "../../model/exercise-answers.client";
import { expectPhoneLayout } from "@/storybook/phone-layout";
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

async function pick(canvasElement: HTMLElement, labels: readonly string[]) {
  const match = within(canvasElement);
  const selects = match.getAllByRole("combobox");
  for (const [index, label] of labels.entries()) {
    const select = selects[index];
    if (select === undefined) throw new Error("Missing row");
    await userEvent.selectOptions(select, label);
  }
}

/** Every row has its own drop-down list; «Проверить» waits for all of them. */
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const match = within(canvasElement);
    await expect(match.getAllByRole("combobox")).toHaveLength(3);
    await expect(
      match.getByRole("combobox", { name: /Нарезка документов на чанки/u }),
    ).toHaveValue("");
    await expect(
      match.getByRole("button", { name: "Проверить" }),
    ).toBeDisabled();
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
    await expect(
      match.getByText("Чанки готовят заранее, при индексации."),
    ).toBeVisible();
    await expect(match.getAllByText("Верно", { exact: true })).toHaveLength(3);
  },
};

/** Each row gets its own verdict and explanation; a wrong row names the right answer. */
export const PartlyWrong: Story = {
  play: async ({ canvasElement }) => {
    const match = within(canvasElement);
    await pick(canvasElement, ["Извлечение", "Индексация", "Генерация ответа"]);
    await userEvent.click(match.getByRole("button", { name: "Проверить" }));
    await expect(
      match.getByText("Пока неверно: 1 из 3", { exact: true }),
    ).toBeVisible();
    await expect(
      match.getByText("Верный ответ: Индексация", { exact: true }),
    ).toBeVisible();
    await expect(
      match.getByText("Верный ответ: Извлечение", { exact: true }),
    ).toBeVisible();
    await expect(match.getAllByText("Верно", { exact: true })).toHaveLength(1);
    for (const select of match.getAllByRole("combobox"))
      await expect(select).toBeDisabled();
  },
};

/** The option a list offers under the given label. */
function option(select: HTMLElement, label: string): HTMLOptionElement {
  const found = within(select).getByRole<HTMLOptionElement>("option", {
    name: label,
  });
  return found;
}

/** Pairs are one to one: a choice taken by one row is unavailable in the others until freed. */
export const OneToOne: Story = {
  play: async ({ canvasElement }) => {
    const match = within(canvasElement);
    const [first, second, third] = match.getAllByRole("combobox");
    if (first === undefined || second === undefined || third === undefined)
      throw new Error("Missing row");
    await userEvent.selectOptions(first, "Индексация");
    await expect(option(first, "Индексация")).toBeEnabled();
    await expect(option(second, "Индексация")).toBeDisabled();
    await expect(option(third, "Индексация")).toBeDisabled();
    await expect(option(second, "Извлечение")).toBeEnabled();
    await userEvent.selectOptions(first, "Извлечение");
    await expect(option(second, "Индексация")).toBeEnabled();
    await expect(option(second, "Извлечение")).toBeDisabled();
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
      await expect(select).toHaveValue("");
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
    await expect(
      match.getByText(/В одну группу может попасть несколько строк/u),
    ).toBeVisible();
    const [first, second] = match.getAllByRole("combobox");
    if (first === undefined || second === undefined)
      throw new Error("Missing row");
    await userEvent.selectOptions(first, "Заранее, при индексации");
    await expect(option(second, "Заранее, при индексации")).toBeEnabled();
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
    await expect(
      match.getByText("Верный ответ: На каждый запрос", { exact: true }),
    ).toBeVisible();
    await expect(
      match.getByText("Поиск идёт по каждому вопросу."),
    ).toBeVisible();
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
    await expect(
      match.getByText("Верный ответ: Индексация", { exact: true }),
    ).toBeVisible();
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
    await expect(
      match.getByRole("combobox", { name: /Нарезка документов/u }),
    ).toHaveValue("index");
    await expect(
      match.getByRole("combobox", { name: /Поиск ближайших/u }),
    ).toHaveValue("");
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
