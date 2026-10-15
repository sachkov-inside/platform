import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { expect, userEvent, within } from "storybook/test";
import {
  courseGuide,
  courseNext,
  taskOnlyCourse,
} from "@/storybook/course-reading.fixtures";
import {
  CourseReadingLayout,
  CourseReadingHeader,
  CourseReadingFooter,
} from "./course-reading.client";
const meta = {
  ...publicPageEnvironment("/materials/course-intro"),
  component: CourseReadingLayout,
  title: "Features/Library/Course Reading",
  args: { context: courseGuide, children: <p>Текст материала</p> },
} satisfies Meta<typeof CourseReadingLayout>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ChapterNavigation: Story = {
  render: () => (
    <CourseReadingLayout context={courseGuide}>
      <CourseReadingHeader
        context={courseGuide}
        title="Как устроен курс"
        metadata={<span>Гайд · AI Engineering</span>}
      />
      <p className="mt-8">
        Глава и соседние шаги взяты из одного состава курса.
      </p>
      <CourseReadingFooter context={courseGuide} />
    </CourseReadingLayout>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selector = canvas.queryByRole("combobox", { name: "Глава курса" });
    if (selector === null || selector.getClientRects().length === 0) return;
    const chevron = selector.querySelector("svg");
    if (chevron === null) throw new Error("Chapter chevron missing");
    await expect(chevron.getBoundingClientRect().right).toBeLessThanOrEqual(
      selector.getBoundingClientRect().right,
    );
    await userEvent.click(selector);
    await expect(
      within(document.body)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Подготовь проект к разработке с агентом и проверь настройку",
      "Продолжение",
      "Следующая глава",
    ]);
    await userEvent.click(
      within(document.body).getByRole("option", { name: "Продолжение" }),
    );
    await expect(selector).toHaveTextContent("Продолжение");
    await expect(canvas.getByLabelText("Текущая глава")).toHaveTextContent(
      "Следующий урок",
    );
  },
};
export const ServerStepChanges: Story = {
  render: function Changes() {
    const [context, setContext] = useState(courseGuide);
    return (
      <>
        <button
          onClick={() => {
            setContext(courseNext);
          }}
        >
          Следующий урок
        </button>
        <button
          onClick={() => {
            setContext(courseGuide);
          }}
        >
          Вернуться к первому
        </button>
        <CourseReadingLayout context={context}>
          <CourseReadingHeader
            context={context}
            title={context.current.title}
            metadata="AI Engineering"
          />
        </CourseReadingLayout>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selector = canvas.queryByRole("combobox", { name: "Глава курса" });
    if (selector === null || selector.getClientRects().length === 0) return;
    await userEvent.click(selector);
    await userEvent.click(
      within(document.body).getByRole("option", { name: "Продолжение" }),
    );
    await userEvent.click(
      await canvas.findByRole("button", { name: "Следующий урок" }),
    );
    await expect(selector).toHaveTextContent("Продолжение");
    await userEvent.click(
      await canvas.findByRole("button", { name: "Вернуться к первому" }),
    );
    await expect(selector).toHaveTextContent(
      courseGuide.chapters[0]?.name ?? "Missing chapter",
    );
    await expect(
      canvasElement.querySelector('[aria-current="step"]'),
    ).toHaveAttribute("data-course-step", courseGuide.current.id);
  },
};
export const TaskOnly: Story = {
  args: {
    context: taskOnlyCourse,
    children: (
      <CourseReadingHeader
        context={taskOnlyCourse}
        title={taskOnlyCourse.current.title}
        metadata="Задание · AI Engineering"
      />
    ),
  },
};
export const NavigationUnavailable: Story = {
  args: {
    context: null,
    children: (
      <p>Задание остаётся доступным, когда состав курса не загрузился.</p>
    ),
  },
};
