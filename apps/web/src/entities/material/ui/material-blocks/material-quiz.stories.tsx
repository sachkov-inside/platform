import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import {
  ExerciseAnswersProvider,
  type ExerciseAnswerRecord,
} from "../../model/exercise-answers.client";
import {
  MaterialQuiz,
  type MaterialQuizPresentation,
} from "./material-quiz.client";

function MultipleQuiz(props: MaterialQuizPresentation) {
  return <MaterialQuiz {...props} />;
}

const labels = [
  "Приглашать сотрудников и управлять их доступом",
  "Хранить проекты со всеми их репозиториями",
  "Интегрироваться с GitHub",
  "Подключать агента разработчика",
  "Выполнять задачи агентами в облаке",
  "Учитывать расходы на модели",
];
const meta = {
  id: "entities-material-quiz",
  title: "Components/Material/Quiz",
  component: MultipleQuiz,
  args: {
    id: "mvp-features",
    heading: "Упражнение 2 из 4",
    selectionMode: "multiple",
    question: "Какие возможности входят в первую версию платформы?",
    options: labels.map((content, index) => ({
      id: `feature-${String(index)}`,
      content,
      correct: index < 4,
      explanation:
        index < 4
          ? "Входит в первую версию."
          : "Направление будущего развития.",
    })),
    dontKnow: {
      explanation:
        "Начни с аккаунтов, проектов, интеграции с GitHub и подключения своего агента.",
      reviewLinks: ["#первая-версия"],
    },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MultipleQuiz>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MultipleEmpty: Story = {
  play: async ({ canvasElement }) => {
    const quiz = within(canvasElement);
    await expect(
      quiz.getByRole("button", { name: "Проверить" }),
    ).toBeDisabled();
    await expect(quiz.queryByText("Не подходит", { exact: true })).toBeNull();
    await expect(quiz.getAllByRole("checkbox")).toHaveLength(6);
  },
};
export const MultipleCorrect: Story = {
  play: async ({ canvasElement }) => {
    const quiz = within(canvasElement);
    for (const checkbox of quiz.getAllByRole("checkbox").slice(0, 4))
      await userEvent.click(checkbox);
    await expect(quiz.queryByText("Правильно", { exact: true })).toBeNull();
    await userEvent.click(quiz.getByRole("button", { name: "Проверить" }));
    await expect(quiz.getByText("Правильно", { exact: true })).toBeVisible();
  },
};
export const MultiplePartial: Story = {
  play: async ({ canvasElement }) => {
    const quiz = within(canvasElement);
    const first = quiz.getAllByRole("checkbox")[0];
    if (first === undefined) throw new Error("Missing checkbox");
    await userEvent.click(first);
    await userEvent.click(quiz.getByRole("button", { name: "Проверить" }));
    await expect(quiz.getByText("Пока неверно", { exact: true })).toBeVisible();
    await expect(
      quiz.getAllByText("Не подходит", { exact: true }),
    ).toHaveLength(2);
  },
};
export const MultipleExtra: Story = {
  play: async ({ canvasElement }) => {
    const quiz = within(canvasElement);
    for (const checkbox of quiz.getAllByRole("checkbox").slice(0, 5))
      await userEvent.click(checkbox);
    await userEvent.click(quiz.getByRole("button", { name: "Проверить" }));
    await expect(quiz.getByText("Пока неверно", { exact: true })).toBeVisible();
  },
};
export const MultipleDontKnow: Story = {
  play: async ({ canvasElement }) => {
    const quiz = within(canvasElement);
    await userEvent.click(quiz.getByRole("button", { name: "Не знаю" }));
    await expect(quiz.getByText("Не знаю · без оценки")).toBeVisible();
    await expect(
      quiz.getAllByText("Не подходит", { exact: true }),
    ).toHaveLength(2);
    await expect(quiz.getAllByText("Входит в первую версию.")).toHaveLength(4);
    await expect(
      quiz.getByRole("link", { name: "Повторить раздел" }),
    ).toHaveAttribute("href", "#первая-версия");
  },
};
/** A checked answer stays until «Ответить ещё раз», which starts a fresh selection. */
export const MultipleAnswerAgain: Story = {
  play: async ({ canvasElement }) => {
    const quiz = within(canvasElement);
    await expect(
      quiz.getByRole("heading", { name: "Упражнение 2 из 4" }),
    ).toBeVisible();
    await userEvent.click(quiz.getByRole("button", { name: "Не знаю" }));
    const first = quiz.getAllByRole("checkbox")[0];
    if (first === undefined) throw new Error("Missing checkbox");
    await expect(first).toBeDisabled();
    await expect(quiz.queryByRole("button", { name: "Проверить" })).toBeNull();
    await userEvent.click(
      quiz.getByRole("button", { name: "Ответить ещё раз" }),
    );
    await expect(quiz.queryByText("Не подходит", { exact: true })).toBeNull();
    await expect(quiz.queryByText("Не знаю · без оценки")).toBeNull();
    await userEvent.click(first);
    await userEvent.click(quiz.getByRole("button", { name: "Проверить" }));
    await expect(quiz.getByText("Пока неверно", { exact: true })).toBeVisible();
    await expect(first).toBeChecked();
    await userEvent.click(
      quiz.getByRole("button", { name: "Ответить ещё раз" }),
    );
    await expect(first).not.toBeChecked();
    await expect(
      quiz.getByRole("button", { name: "Проверить" }),
    ).toBeDisabled();
  },
};
export const MultipleKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const quiz = within(canvasElement);
    const first = quiz.getAllByRole("checkbox")[0];
    if (first === undefined) throw new Error("Missing checkbox");
    first.focus();
    await userEvent.keyboard(" ");
    await expect(first).toBeChecked();
    await userEvent.tab();
    await expect(quiz.getAllByRole("checkbox")[1]).toHaveFocus();
    await userEvent.keyboard(" ");
    await userEvent.click(quiz.getByRole("button", { name: "Проверить" }));
    await expect(quiz.getByText("Пока неверно", { exact: true })).toBeVisible();
  },
};
export const MultipleMobile: Story = {
  ...MultipleCorrect,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async (context) => {
    await MultipleCorrect.play?.(context);
    for (const option of context.canvasElement.querySelectorAll<HTMLElement>(
      "[data-quiz-option]",
    )) {
      await expect(option.scrollWidth).toBeLessThanOrEqual(option.clientWidth);
      await expect(
        option.getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(44);
    }
    await expect(document.documentElement.scrollWidth).toBe(
      document.documentElement.clientWidth,
    );
  },
};

/** A past answer restored from an older version, with the guest's line under the exercise. */
function useRestoredAnswer(): {
  readonly current: ExerciseAnswerRecord | null;
  readonly updated: boolean;
  readonly note: React.ReactNode;
  readonly answer: (record: ExerciseAnswerRecord) => void;
  readonly retry: () => void;
} {
  const [current, setCurrent] = useState<ExerciseAnswerRecord | null>({
    answer: { kind: "options", optionIds: ["feature-0", "feature-4"] },
    result: "incorrect",
  });
  return {
    current,
    updated: current !== null,
    note: "Войдите, чтобы ответы сохранялись в аккаунте.",
    answer: setCurrent,
    retry: () => {
      setCurrent(null);
    },
  };
}

export const UpdatedPastAnswer: Story = {
  decorators: [
    (Story) => (
      <ExerciseAnswersProvider source={useRestoredAnswer}>
        <Story />
      </ExerciseAnswersProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const quiz = within(canvasElement);
    await expect(
      quiz.getByText("Упражнение обновлено, ответь ещё раз"),
    ).toBeVisible();
    await expect(quiz.getByText("Пока неверно", { exact: true })).toBeVisible();
    await expect(
      quiz.getByText("Войдите, чтобы ответы сохранялись в аккаунте."),
    ).toBeVisible();
    await userEvent.click(
      quiz.getByRole("button", { name: "Ответить ещё раз" }),
    );
    await expect(
      quiz.queryByText("Упражнение обновлено, ответь ещё раз"),
    ).toBeNull();
  },
};
