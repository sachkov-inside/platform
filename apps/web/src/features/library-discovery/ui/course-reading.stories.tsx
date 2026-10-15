import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { courseReadingContext } from "@/features/library-discovery";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  courseGuide,
  courseTask,
  courseSource,
  courseNext,
  taskOnlyCourse,
} from "@/storybook/course-reading.fixtures";
import {
  CourseTaskSubmissionStatuses,
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
export const LongChapter: Story = {
  render: () => {
    const steps = Array.from({ length: 20 }, (_, index) => ({
      ...courseGuide.current,
      id: `long-chapter-${String(index)}`,
      title: `Практический шаг ${String(index + 1)}: проверь работу приложения с агентом`,
    }));
    const current = steps.at(-1) ?? courseGuide.current;
    const context = {
      ...courseGuide,
      current,
      chapters: courseGuide.chapters.map((chapter) =>
        chapter.id === courseGuide.currentChapterId
          ? { ...chapter, steps }
          : chapter,
      ),
    };
    return (
      <CourseReadingLayout context={context}>
        <CourseReadingHeader
          context={context}
          title={current.title}
          metadata={null}
        />
      </CourseReadingLayout>
    );
  },
  play: async ({ canvasElement }) => {
    const rail = within(canvasElement).queryByRole("navigation", {
      name: "Шаги текущей главы",
    });
    if (rail === null || rail.getClientRects().length === 0) return;
    rail.focus();
    rail.scrollTo({ top: rail.scrollHeight, behavior: "instant" });
    await waitFor(async () => {
      const last = rail.querySelector("li:last-child");
      if (last === null) throw new Error("Last course step missing");
      const gap =
        rail.getBoundingClientRect().bottom -
        last.getBoundingClientRect().bottom;
      await expect(gap).toBeGreaterThanOrEqual(24);
      await expect(last.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        rail.getBoundingClientRect().top,
      );
    });
  },
};
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
    const nextChapter = within(document.body).getByRole("option", {
      name: "Глава 2 Продолжение",
    });
    await userEvent.hover(nextChapter);
    await expect(getComputedStyle(nextChapter).outlineStyle).toBe("none");
    await expect(getComputedStyle(nextChapter).textDecorationLine).toBe("none");
    await userEvent.click(nextChapter);
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
                lastSubmittedAt: "2026-10-14T09:00:00.000Z",
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
        <CourseReadingHeader
          context={context}
          title={context.current.title}
          metadata={null}
        />
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
        name: "Задание 1 Подготовь проект к работе с агентом Сдано",
      }),
    ).toBeVisible();
    const savedTitle = canvasElement.querySelector(
      '[data-task-submitted="true"]',
    );
    if (savedTitle === null) throw new Error("Saved Task title missing");
    await expect(getComputedStyle(savedTitle).textDecorationLine).toBe(
      "line-through",
    );
    const current = canvas.getByRole("link", {
      name: "Задание 2 Заложи основу проекта",
    });
    await expect(current).toHaveAttribute("aria-current", "step");
    const title = current.querySelector('[class*="stepTitle"]');
    if (title === null) throw new Error("Current title missing");
    await expect(getComputedStyle(title).fontWeight).toBe("500");
    await expect(getComputedStyle(current).backgroundColor).toBe(
      "rgba(0, 0, 0, 0)",
    );
    await userEvent.click(selector);
    await userEvent.click(
      within(document.body).getByRole("option", {
        name: "Глава 2 Продолжение",
      }),
    );
    await expect(
      await canvas.findByRole("link", { name: "Задание 1 Спроектируй MVP" }),
    ).toBeVisible();
  },
};

export const SubmittedCurrentAssignment: Story = {
  render: () => {
    const current = { ...taskOnlyCourse.current, taskSubmitted: true };
    const context = {
      ...taskOnlyCourse,
      current,
      chapters: taskOnlyCourse.chapters.map((chapter) => ({
        ...chapter,
        steps: chapter.steps.map((step) =>
          step.id === current.id ? current : step,
        ),
      })),
    };
    return (
      <CourseReadingLayout context={context}>
        <CourseReadingHeader
          context={context}
          title={current.title}
          metadata={null}
        />
      </CourseReadingLayout>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const opener = canvas.queryByRole("button", {
      name: "Вся программа",
    });
    if (opener !== null && opener.getClientRects().length > 0)
      await userEvent.click(opener);
    const link = within(document.body)
      .getAllByRole("link")
      .find(
        (entry) =>
          entry.getAttribute("aria-current") === "step" &&
          entry.getClientRects().length > 0,
      );
    if (link === undefined) throw new Error("Current submitted Task missing");
    const title = link.querySelector('[data-task-submitted="true"]');
    if (title === null) throw new Error("Submitted title missing");
    await expect(getComputedStyle(title).fontWeight).toBe("500");
    await expect(getComputedStyle(title).textDecorationLine).toBe(
      "line-through",
    );
    await expect(getComputedStyle(link).backgroundColor).toBe(
      "rgba(0, 0, 0, 0)",
    );
  },
};

export const StreamedTaskSubmissionStatuses: Story = {
  render: function Streamed() {
    const [personal, setPersonal] = useState(false);
    return (
      <CourseReadingLayout context={taskOnlyCourse}>
        <button
          onClick={() => {
            setPersonal(true);
          }}
        >
          Получить личные статусы
        </button>
        <button
          onClick={() => {
            setPersonal(false);
          }}
        >
          Убрать личный контекст
        </button>
        {personal ? (
          <CourseTaskSubmissionStatuses
            courseHref={taskOnlyCourse.courseHref}
            submittedTaskIds={[taskOnlyCourse.current.id]}
          />
        ) : null}
        <p>Тело урока доступно до загрузки личных статусов.</p>
      </CourseReadingLayout>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Тело урока доступно до загрузки личных статусов."),
    ).toBeVisible();
    await userEvent.click(
      canvas.getByRole("button", { name: "Получить личные статусы" }),
    );
    await expect(
      canvasElement.querySelector('[data-task-submitted="true"]'),
    ).not.toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "Убрать личный контекст" }),
    );
    await expect(
      canvasElement.querySelector('[data-task-submitted="true"]'),
    ).toBeNull();
  },
};

export const SupplementaryBreadcrumbs: Story = {
  render: function SupplementaryOrigin() {
    const [taskOrigin, setTaskOrigin] = useState(false);
    return (
      <>
        <button
          onClick={() => {
            setTaskOrigin(true);
          }}
        >
          Открыть из задания
        </button>
        <CourseReadingHeader
          context={taskOrigin ? courseTask : courseGuide}
          title="Описание учебного проекта"
          metadata={null}
          supplementary
        />
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const crumbs = within(
      canvas.getByRole("navigation", { name: "Хлебные крошки" }),
    );
    await expect(
      crumbs.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["AI Engineering", "Глава 1", "Описание учебного проекта"]);
    await userEvent.click(
      canvas.getByRole("button", { name: "Открыть из задания" }),
    );
    await expect(
      crumbs.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual([
      "AI Engineering",
      "Глава 1",
      "Задание",
      "Описание учебного проекта",
    ]);
  },
};
