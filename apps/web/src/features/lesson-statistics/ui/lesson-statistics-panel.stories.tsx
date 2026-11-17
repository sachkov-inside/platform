import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { lessonStatisticsScenario } from "@/storybook/lesson-statistics.fixtures";

import { LessonStatisticsPanel } from "./lesson-statistics-panel";

const meta = {
  id: "features-lesson-statistics",
  title: "Components/Админка/Редактор/Lesson statistics",
  component: LessonStatisticsPanel,
  args: {
    state: lessonStatisticsScenario,
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[60rem] p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LessonStatisticsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Ratings, then each exercise with its versions, the current version first. */
export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const panel = within(canvasElement);
    await expect(
      panel.getByText("«Как вам урок?»: понравился 12, не понравился 3"),
    ).toBeVisible();
    await expect(panel.getByText("Текущая версия")).toBeVisible();
    await expect(panel.getByText("Прежняя версия")).toBeVisible();
    await expect(panel.getByText("55%")).toBeVisible();
    await expect(panel.getByText("Эмбеддинги (11)")).toBeVisible();
    await expect(panel.getByText("Пока никто не ответил.")).toBeVisible();
  },
};

export const Forbidden: Story = {
  args: { state: { kind: "forbidden" } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent(
      "Статистика доступна только тем, кто управляет материалами.",
    );
  },
};
