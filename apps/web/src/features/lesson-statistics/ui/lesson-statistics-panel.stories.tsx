import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { LessonStatisticsPanel } from "./lesson-statistics-panel";

const meta = {
  id: "features-lesson-statistics",
  title: "Components/Админка/Редактор/Lesson statistics",
  component: LessonStatisticsPanel,
  args: {
    state: {
      kind: "ready",
      ratings: { likes: 12, dislikes: 3 },
      exercises: [
        {
          exerciseId: "rag-wrong-platform",
          title: "Упражнение 1",
          question: "На каком шаге RAG ошибается чаще всего?",
          versions: [
            {
              fingerprint: "669258ca11c32c41",
              current: true,
              firstAnsweredAt: "2026-11-10T09:00:00.000Z",
              respondents: 40,
              firstTryCorrectPercent: 55,
              firstTryDontKnow: 4,
              mostFrequentWrong: {
                label: "Частый неверный ответ",
                text: "Эмбеддинги",
                count: 11,
              },
            },
            {
              fingerprint: "00000000000000aa",
              current: false,
              firstAnsweredAt: "2026-10-01T09:00:00.000Z",
              respondents: 18,
              firstTryCorrectPercent: 28,
              firstTryDontKnow: 0,
              mostFrequentWrong: {
                label: "Частый неверный ответ",
                text: "Промпт",
                count: 9,
              },
            },
          ],
        },
        {
          exerciseId: "pipeline",
          title: "Упражнение 2",
          question: "Расставь шаги поставки",
          versions: [],
        },
      ],
    },
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
