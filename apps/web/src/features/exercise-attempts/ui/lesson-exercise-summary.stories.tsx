import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { LessonExerciseSummary } from "./lesson-exercise-summary";

const meta = {
  id: "features-lesson-exercise-summary",
  title: "Components/Material/Lesson exercise summary",
  component: LessonExerciseSummary,
  args: {
    total: 4,
    solved: 2,
    unsolved: [
      { id: "rag-wrong-platform", number: 2, fingerprint: "669258ca11c32c41" },
      { id: "pipeline", number: 4, fingerprint: "fedf00a6d2dab0fb" },
    ],
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[43rem] p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LessonExerciseSummary>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Unsolved exercises link to their place in the lesson. */
export const SomeUnsolved: Story = {
  play: async ({ canvasElement }) => {
    const summary = within(canvasElement);
    await expect(summary.getByText("Упражнения: 2 из 4 решены")).toBeVisible();
    await expect(
      summary.getByRole("link", { name: "Упражнение 2" }),
    ).toHaveAttribute("href", "#exercise-rag-wrong-platform");
    await expect(
      summary.getByRole("link", { name: "Упражнение 4" }),
    ).toHaveAttribute("href", "#exercise-pipeline");
  },
};

export const AllSolved: Story = {
  args: { total: 3, solved: 3, unsolved: [] },
  play: async ({ canvasElement }) => {
    const summary = within(canvasElement);
    await expect(summary.getByText("Упражнения: 3 из 3 решены")).toBeVisible();
    await expect(summary.queryAllByRole("link")).toHaveLength(0);
  },
};
