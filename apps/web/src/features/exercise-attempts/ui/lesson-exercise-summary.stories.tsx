import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { expectPhoneLayout } from "@/storybook/phone-layout";

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

/** One row: a marker per exercise, solved ones ticked, and a link to the first unsolved one. */
export const SomeUnsolved: Story = {
  play: async ({ canvasElement }) => {
    const summary = within(canvasElement);
    await expect(summary.getByText("Упражнения: 2 из 4 решены")).toBeVisible();
    await expect(summary.getAllByRole("link")).toHaveLength(1);
    await expect(
      summary.getByRole("link", { name: "Решить упражнение 2" }),
    ).toHaveAttribute("href", "#exercise-rag-wrong-platform");
    await expect(
      [...canvasElement.querySelectorAll("[data-lesson-exercise-marker]")].map(
        (marker) => marker.getAttribute("data-lesson-exercise-marker"),
      ),
    ).toEqual(["solved", "open", "solved", "open"]);
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

export const Phone360: Story = {
  globals: { viewport: { value: "mobile360", isRotated: false } },
  args: {
    total: 8,
    solved: 5,
    unsolved: [
      { id: "a", number: 3, fingerprint: "a" },
      { id: "b", number: 6, fingerprint: "b" },
      { id: "c", number: 7, fingerprint: "c" },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("link", { name: "Решить упражнение 3" }),
    ).toBeVisible();
    await expectPhoneLayout(canvasElement, "[data-lesson-exercise-summary]");
  },
};
