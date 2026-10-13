import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import {
  courseGuide,
  courseTask,
  taskOnlyCourse,
} from "@/storybook/course-reading.fixtures";
import {
  CourseReadingLayout,
  CourseReadingHeader,
  CourseReadingFooter,
} from "./course-reading.client";
const meta = {
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
    expect(chevron.getBoundingClientRect().right).toBeLessThanOrEqual(
      selector.getBoundingClientRect().right,
    );
    await userEvent.click(selector);
    await userEvent.click(
      within(document.body).getByRole("option", { name: "Продолжение" }),
    );
    await expect(selector).toHaveTextContent("Продолжение");
    await expect(canvas.getByLabelText("Текущая глава")).toHaveTextContent(
      "Доступ закрыт",
    );
  },
};
export const ServerStepChanges: Story = {
  render: function Changes() {
    const [context, setContext] = useState(courseGuide);
    return (
      <>
        <button onClick={() => setContext(courseTask)}>Открыть задание</button>
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
    await userEvent.click(
      canvas.getByRole("button", { name: "Открыть задание" }),
    );
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent(
      courseTask.current.title,
    );
    await expect(
      canvasElement.querySelector('[aria-current="step"]'),
    ).toHaveAttribute("data-course-step", courseTask.current.id);
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
