import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { courseReadingContext } from "@/features/library-discovery";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { expect, userEvent, within } from "storybook/test";
import {
  courseGuide,
  courseSource,
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
      "Глава 1 Подготовь проект к разработке с агентом и проверь настройку",
      "Глава 2 Продолжение",
      "Глава 3 Следующая глава",
    ]);
    await userEvent.click(
      within(document.body).getByRole("option", {
        name: "Глава 2 Продолжение",
      }),
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
      within(document.body).getByRole("option", {
        name: "Глава 2 Продолжение",
      }),
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

export const TabletProgramme: Story = {
  ...ChapterNavigation,
  globals: { viewport: { value: "tablet820", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvasElement.querySelector('nav[aria-label="Навигация по урокам"]'),
    ).not.toBeVisible();
    const trigger = canvas.getByRole("button", { name: "Вся программа" });
    await userEvent.click(trigger);
    const dialog = canvas.getByRole("dialog", {
      name: "Программа: AI Engineering",
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getBoundingClientRect().left).toBe(0);
    await expect(
      within(dialog).getByRole("link", { current: "step" }),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Закрыть программу" }),
    );
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toHaveFocus();
  },
};
export const PhoneProgramme: Story = {
  ...ChapterNavigation,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("navigation", { name: "Навигация по урокам" }),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Вся программа" }),
    );
    const dialog = canvas.getByRole("dialog", {
      name: "Программа: AI Engineering",
    });
    await expect(dialog).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Закрыть программу" }),
    );
    await expect(dialog).not.toBeVisible();
  },
};

export const NumberedAssignments: Story = {
  render: () => {
    const firstTask = courseSource.chapters[0].tasks[0];
    const context = courseReadingContext({
      series: {
        ...courseSource,
        chapters: [
          {
            ...courseSource.chapters[0],
            tasks: [
              {
                ...firstTask,
                code: "harness",
                title: "Подготовь проект к работе с агентом",
                afterMaterialId: "first-id",
              },
              {
                ...firstTask,
                code: "foundation",
                title: "Заложи основу проекта",
                afterMaterialId: "first-id",
              },
            ],
          },
          {
            ...courseSource.chapters[1],
            tasks: [
              {
                ...firstTask,
                code: "chapter-two-task",
                title: "Спроектируй MVP",
                afterMaterialId: null,
              },
            ],
          },
        ],
      },
      current: { kind: "task", code: "foundation" },
    });
    if (context === null)
      throw new Error("Numbered task fixture must contain its selected Task");
    return (
      <CourseReadingLayout context={context}>
        <CourseReadingHeader context={context} title={context.current.title} />
        <p className="mt-8">Номера заданий начинаются заново в каждой главе.</p>
      </CourseReadingLayout>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selector = canvas.queryByRole("combobox", { name: "Глава курса" });
    if (selector === null || selector.getClientRects().length === 0) return;
    await expect(
      canvas.getByRole("link", {
        name: "Задание 1 Подготовь проект к работе с агентом",
      }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("link", { name: "Задание 2 Заложи основу проекта" }),
    ).toHaveAttribute("aria-current", "step");
    await userEvent.click(selector);
    await userEvent.click(
      within(document.body).getByRole("option", {
        name: "Глава 2 Продолжение",
      }),
    );
    await expect(
      canvas.getByRole("link", { name: "Задание 1 Спроектируй MVP" }),
    ).toBeVisible();
  },
};
