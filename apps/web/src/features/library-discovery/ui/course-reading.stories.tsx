import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  courseReadingContext,
  withDeferredTaskStatuses,
} from "@/features/library-discovery";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  courseGuide,
  courseTask,
  courseSource,
  courseNext,
  taskOnlyCourse,
  progressCourse,
  progressCourseMarks,
} from "@/storybook/course-reading.fixtures";
import { MaterialReadingScope } from "@/entities/material";
import {
  CourseTaskSubmissionStatuses,
  CourseReadingLayout,
  CourseReadingHeader,
  CourseReadingFooter,
} from "./course-reading.client";
const meta = {
  ...publicPageEnvironment("/materials/course-intro"),
  component: CourseReadingLayout,
  id: "features-library-course-reading",
  title: "Patterns/Product/Course reading",
  args: { context: courseGuide, children: <p>Текст материала</p> },
} satisfies Meta<typeof CourseReadingLayout>;
export default meta;
type Story = StoryObj<typeof meta>;
export const StableSelection: Story = {
  render: function Selection() {
    const first = {
      ...courseGuide.current,
      id: "stable-first",
      title: "Подготовь проект к работе с агентом и проверь настройку",
    };
    const second = {
      ...courseGuide.current,
      id: "stable-second",
      title: "Как устроен пайплайн разработки с агентом",
    };
    const [selectSecond, setSelectSecond] = useState(false);
    const context = {
      ...courseGuide,
      current: selectSecond ? second : first,
      chapters: courseGuide.chapters.map((chapter) =>
        chapter.id === courseGuide.currentChapterId
          ? { ...chapter, steps: [first, second] }
          : chapter,
      ),
    };
    return (
      <CourseReadingLayout context={context}>
        <button
          onClick={() => {
            setSelectSecond((value) => !value);
          }}
        >
          Сменить выбранный урок
        </button>
      </CourseReadingLayout>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = canvas.queryByRole("navigation", {
      name: "Шаги текущей главы",
    });
    if (rail === null || rail.getClientRects().length === 0) return;
    await document.fonts.ready;
    const geometry = () =>
      Array.from(rail.querySelectorAll("[data-course-step]")).map((step) => {
        const title = step.querySelector('[class*="stepTitle"]');
        if (title === null) throw new Error("Course title missing");
        const range = document.createRange();
        range.selectNodeContents(title);
        return {
          height: step.getBoundingClientRect().height,
          lines: Array.from(range.getClientRects()).map((rect) => rect.width),
        };
      });
    const before = geometry();
    await userEvent.click(
      canvas.getByRole("button", { name: "Сменить выбранный урок" }),
    );
    await expect(geometry()).toEqual(before);
    await expect(
      rail.querySelector('[data-course-step="stable-second"]'),
    ).toHaveAttribute("aria-current", "step");
  },
};
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
    const selector = canvas.queryByRole("button", { name: /^Глава \d+ из/ });
    if (selector === null || selector.getClientRects().length === 0) return;
    const chevron = selector.querySelector("svg");
    if (chevron === null) throw new Error("Chapter chevron missing");
    await expect(chevron.getBoundingClientRect().right).toBeLessThanOrEqual(
      selector.getBoundingClientRect().right,
    );
    await userEvent.click(selector);
    await expect(selector).toHaveAttribute("aria-expanded", "true");
    const chapters = canvas.getByRole("navigation", { name: "Главы курса" });
    await expect(
      within(chapters)
        .getAllByRole("button")
        .map((option) => option.textContent),
    ).toEqual([
      "Глава 1 Подготовь проект к разработке с агентом и проверь настройку, вы здесь",
      "Глава 2 Продолжение",
      "Глава 3 Следующая глава",
    ]);
    const nextChapter = within(chapters).getByRole("button", {
      name: "Глава 2 Продолжение",
    });
    await userEvent.hover(nextChapter);
    await expect(getComputedStyle(nextChapter).textDecorationLine).toBe("none");
    await userEvent.click(nextChapter);
    await expect(selector).toHaveAttribute("aria-expanded", "false");
    await expect(selector).toHaveFocus();
    await expect(selector).toHaveTextContent("Продолжение");
    await expect(canvas.getByLabelText("Текущая глава")).toHaveTextContent(
      "Следующий урок",
    );
  },
};
export const LongChapterTitles: Story = {
  render: () => {
    const names = [
      "Подготовь проект к разработке: harness, skills и AI-first процесс",
      "Разработка с агентом на практике: аккаунты и MCP",
      "Релиз в продакшен: CI/CD, развёртывание и мониторинг",
      "Инфраструктура агентов в AI-first платформе: MCP, skills и управление контекстом",
      "Разработка своего агента для AI-first платформы: tool calling, сессии и память",
      "Оценка качества агента: evals, трассировка и регрессии",
      "Командная работа с агентами: ревью, роли и границы ответственности",
    ];
    const [first, second] = courseGuide.chapters;
    if (first === undefined || second === undefined)
      throw new Error("Course fixture must contain two chapters");
    const chapters = names.map((name, index) => ({
      ...(index === 1 ? first : second),
      id: `long-title-${String(index)}`,
      name,
      ordinal: index + 1,
    }));
    const context = {
      ...courseGuide,
      chapters,
      currentChapterId: "long-title-1",
    };
    return (
      <CourseReadingLayout context={context}>
        <CourseReadingHeader
          context={context}
          title="Как спроектировать аккаунты и доступ"
          metadata={null}
        />
      </CourseReadingLayout>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = canvas.queryByRole("button", { name: /^Глава 2 из 7/ });
    if (heading === null || heading.getClientRects().length === 0) return;
    const rail = canvas.getByRole("complementary", { name: "Текущая глава" });
    await userEvent.click(heading);
    const chapters = canvas.getByRole("navigation", { name: "Главы курса" });
    await expect(
      within(chapters).getByRole("button", { current: true }),
    ).toHaveTextContent("Разработка с агентом на практике");
    await expect(within(chapters).getByText(", вы здесь")).toBeInTheDocument();
    await expect(chapters.getBoundingClientRect().right).toBeLessThanOrEqual(
      rail.getBoundingClientRect().right,
    );
    await userEvent.keyboard("{Escape}");
    await expect(heading).toHaveAttribute("aria-expanded", "false");
    await expect(heading).toHaveFocus();
    await expect(
      canvas.getByRole("navigation", { name: "Шаги текущей главы" }),
    ).toBeVisible();
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
    const selector = canvas.queryByRole("button", { name: /^Глава \d+ из/ });
    if (selector === null || selector.getClientRects().length === 0) return;
    await userEvent.click(selector);
    await userEvent.click(
      canvas.getByRole("button", { name: "Глава 2 Продолжение" }),
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
    // Tablets share the phone's lesson dock; the programme opens as the same bottom sheet.
    const dock = within(
      canvas.getByRole("navigation", { name: "Навигация по урокам" }),
    );
    const trigger = dock.getByRole("button", { name: "Вся программа" });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveTextContent("Глава 1 · Шаг 2 из 3");
    await userEvent.click(trigger);
    const dialog = canvas.getByRole("dialog", {
      name: "Программа: AI Engineering",
    });
    await expect(dialog).toBeVisible();
    await waitFor(async () => {
      await expect(Math.round(dialog.getBoundingClientRect().bottom)).toBe(
        window.innerHeight,
      );
    });
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
    const dock = within(
      canvas.getByRole("navigation", { name: "Навигация по урокам" }),
    );
    await expect(
      dock.queryByRole("link", { name: "К прохождению курса" }),
    ).toBeNull();
    // The dock is wide enough to read as controls yet keeps clear side margins.
    const dockBounds = canvas
      .getByRole("navigation", { name: "Навигация по урокам" })
      .getBoundingClientRect();
    await expect(dockBounds.left).toBeGreaterThanOrEqual(24);
    await expect(window.innerWidth - dockBounds.right).toBeGreaterThanOrEqual(
      24,
    );
    await expect(dockBounds.width).toBeGreaterThan(300);
    await document.fonts.ready;
    const label = dock.getByText("Программа", {
      selector: "span",
      exact: true,
    });
    const labelRange = document.createRange();
    labelRange.selectNodeContents(label);
    await expect(labelRange.getClientRects()).toHaveLength(1);
    const textBounds = labelRange.getBoundingClientRect();
    const buttonBounds = dock
      .getByRole("button", { name: "Вся программа" })
      .getBoundingClientRect();
    await expect(textBounds.left - buttonBounds.left).toBeGreaterThanOrEqual(
      12,
    );
    await expect(buttonBounds.right - textBounds.right).toBeGreaterThanOrEqual(
      12,
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Вся программа" }),
    );
    const dialog = canvas.getByRole("dialog", {
      name: "Программа: AI Engineering",
    });
    await expect(dialog).toBeVisible();
    await expect(
      within(dialog).getByRole("link", { name: "К прохождению курса" }),
    ).toHaveAttribute("href", "/products/ai-engineering/programme");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Закрыть программу" }),
    );
    await expect(dialog).not.toBeVisible();
  },
};

export const NarrowSupplementaryProgramme: Story = {
  globals: { viewport: { value: "mobile320", isRotated: false } },
  args: { supplementaryTitle: "Описание учебного проекта" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const navigation = canvas.getByRole("navigation", {
      name: "Навигация по урокам",
    });
    await expect(
      within(navigation).queryByRole("link", { name: "К прохождению курса" }),
    ).toBeNull();
    await expect(
      within(navigation).queryByRole("link", { name: "Следующий шаг" }),
    ).toBeNull();
    await document.fonts.ready;
    // The narrowest phones keep the words and drop the list icon.
    const opener = within(navigation).getByRole("button", {
      name: "Вся программа",
    });
    const icon = opener.querySelector("svg");
    if (icon === null) throw new Error("Programme icon missing");
    await expect(getComputedStyle(icon).display).toBe("none");
    for (const control of navigation.querySelectorAll<HTMLElement>(
      "a, button",
    )) {
      await expect(control.scrollWidth).toBeLessThanOrEqual(
        control.clientWidth,
      );
      await expect(
        control.getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(44);
    }
    await userEvent.click(
      within(navigation).getByRole("button", { name: "Вся программа" }),
    );
    const dialog = canvas.getByRole("dialog", {
      name: "Программа: AI Engineering",
    });
    await expect(
      within(dialog).getByRole("link", { name: "К прохождению курса" }),
    ).toHaveAttribute("href", "/products/ai-engineering/programme");
    await expect(
      within(dialog).getByRole("link", { current: "step" }),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Закрыть программу" }),
    );
    await expect(dialog).not.toBeVisible();
    await expect(
      within(navigation).getByRole("button", { name: "Вся программа" }),
    ).toHaveFocus();
  },
};

export const PhoneFirstStep: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  args: { context: { ...courseGuide, previous: null } },
  play: async ({ canvasElement }) => {
    const navigation = within(
      within(canvasElement).getByRole("navigation", {
        name: "Навигация по урокам",
      }),
    );
    await expect(
      navigation.getByRole("button", { name: "Предыдущий шаг" }),
    ).toBeDisabled();
    await expect(
      navigation.getByRole("link", { name: "Следующий шаг" }),
    ).toHaveAttribute("href", courseGuide.next?.href);
  },
};

export const PhoneLastStep: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
  args: { context: { ...courseGuide, next: null } },
  play: async ({ canvasElement }) => {
    const navigation = within(
      within(canvasElement).getByRole("navigation", {
        name: "Навигация по урокам",
      }),
    );
    await expect(
      navigation.getByRole("button", { name: "Следующий шаг" }),
    ).toBeDisabled();
    await expect(
      navigation.getByRole("link", { name: "Предыдущий шаг" }),
    ).toHaveAttribute("href", courseGuide.previous?.href);
  },
};

export const NumberedAssignments: Story = {
  render: () => {
    const firstTask = courseSource.chapters[0].tasks[0];
    const context = courseReadingContext({
      product: {
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
                afterMaterialId: "00000000-0000-4000-8000-0000000000a2",
              },
              {
                ...firstTask,
                code: "foundation",
                title: "Заложи основу проекта",
                afterMaterialId: "00000000-0000-4000-8000-0000000000a2",
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
    const selector = canvas.queryByRole("button", { name: /^Глава \d+ из/ });
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
    await expect(savedTitle.closest("[data-course-step]")).toHaveAttribute(
      "data-progress",
      "done",
    );
    const current = canvas.getByRole("link", {
      name: "Задание 2 Заложи основу проекта",
    });
    await expect(current).toHaveAttribute("aria-current", "step");
    const title = current.querySelector('[class*="stepTitle"]');
    if (title === null) throw new Error("Current title missing");
    // Emphasis paints over the glyphs, so the line breaks stay where they were.
    await expect(getComputedStyle(title).fontWeight).toBe("400");
    await userEvent.click(selector);
    await userEvent.click(
      canvas.getByRole("button", { name: "Глава 2 Продолжение" }),
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
    await expect(getComputedStyle(title).fontWeight).toBe("400");
    await expect(getComputedStyle(title).textDecorationLine).toBe("none");
    // The current step keeps the accent marker even when it is already passed.
    await expect(link).toHaveAttribute("data-progress", "done");
    await expect(getComputedStyle(link).backgroundColor).not.toBe(
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

export const SupplementaryMaterials: Story = {
  render: function Supplementary() {
    const [second, setSecond] = useState(false);
    const [count, setCount] = useState(6);
    const references = Array.from({ length: count }, (_, index) => ({
      id: `reference-${String(index + 1)}`,
      slug: `reference-${String(index + 1)}`,
      title: `Материал ${String(index + 1)}`,
      href: courseGuide.current.href,
    }));
    const chapter = courseGuide.chapters[0];
    if (chapter === undefined) throw new Error("Course fixture has no chapter");
    const first = { ...chapter, references };
    const next = {
      ...first,
      id: "second-reference-chapter",
      name: "Другая глава",
    };
    const context = {
      ...courseGuide,
      chapters: [first, next],
      currentChapterId: second ? next.id : first.id,
    };
    return (
      <CourseReadingLayout context={context}>
        <button
          onClick={() => {
            setSecond((value) => !value);
          }}
        >
          Сменить главу
        </button>
        {[0, 3, 4, 6].map((value) => (
          <button
            key={value}
            onClick={() => {
              setCount(value);
            }}
          >
            {String(value)}
          </button>
        ))}
      </CourseReadingLayout>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = within(
      canvas.getByRole("complementary", { name: "Текущая глава" }),
    );
    let group = within(
      rail.getByRole("navigation", { name: "Дополнительные материалы" }),
    );
    await expect(group.getAllByRole("link")).toHaveLength(3);
    const toggle = group.getByRole("button", { name: "Показать ещё" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    toggle.focus();
    await userEvent.keyboard("{Enter}");
    await expect(group.getAllByRole("link")).toHaveLength(6);
    await userEvent.click(
      canvas.getByRole("button", { name: "Сменить главу" }),
    );
    group = within(
      rail.getByRole("navigation", { name: "Дополнительные материалы" }),
    );
    await expect(group.getAllByRole("link")).toHaveLength(3);
    await userEvent.click(canvas.getByRole("button", { name: "0" }));
    await expect(
      rail.queryByRole("navigation", { name: "Дополнительные материалы" }),
    ).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "3" }));
    group = within(
      rail.getByRole("navigation", { name: "Дополнительные материалы" }),
    );
    await expect(group.getAllByRole("link")).toHaveLength(3);
    await expect(group.queryByRole("button")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "4" }));
    group = within(
      rail.getByRole("navigation", { name: "Дополнительные материалы" }),
    );
    await userEvent.click(group.getByRole("button", { name: "Показать ещё" }));
    await expect(group.getAllByRole("link")).toHaveLength(4);
    await userEvent.click(group.getByRole("button", { name: "Скрыть" }));
    await expect(group.getAllByRole("link")).toHaveLength(3);
  },
};

function ProgressCourse({
  marks = progressCourseMarks,
  failed = false,
}: {
  readonly marks?: typeof progressCourseMarks;
  readonly failed?: boolean;
}) {
  return (
    <MaterialReadingScope
      value={{
        accountId: "story-account",
        resolved: true,
        failed,
        states: marks,
        register: () => () => undefined,
        refresh: () => Promise.resolve(),
      }}
    >
      <CourseReadingLayout context={progressCourse}>
        <CourseReadingHeader
          context={progressCourse}
          title={progressCourse.current.title}
          metadata={null}
        />
        <p>Текст материала</p>
      </CourseReadingLayout>
    </MaterialReadingScope>
  );
}

/** Rail or programme sheet, whichever the viewport shows. */
async function openProgramme(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const rail = canvas.queryByRole("complementary", { name: "Текущая глава" });
  if (rail !== null && rail.getClientRects().length > 0) return rail;
  await userEvent.click(
    canvas.getAllByRole("button", { name: /^Вся программа/ })[0] ??
      canvasElement,
  );
  return canvas.getByRole("dialog", { name: "Программа: AI Engineering" });
}

export const ReaderProgress: Story = {
  render: () => <ProgressCourse />,
  play: async ({ canvasElement }) => {
    const programme = within(await openProgramme(canvasElement));
    await expect(
      programme.getByText("8 из 13 пройдено", { exact: true }),
    ).toBeVisible();
    const step = (title: string) =>
      programme.getByRole("link", {
        name: new RegExp(`^(Задание \\d )?${title}`),
      });
    await expect(step("Как устроен курс")).toHaveAttribute(
      "data-progress",
      "done",
    );
    await expect(
      step("Подготовка проекта: инструкции, скиллы и репозиторий"),
    ).toHaveAttribute("data-progress", "todo");
    await expect(
      step("Работа над задачей: от обсуждения до pull request"),
    ).toHaveAttribute("data-progress", "done");
    await expect(
      programme.getByRole("link", { current: "step" }),
    ).toHaveAccessibleName("Выбор стека и границ модулей");
  },
};

export const ReaderProgressChapters: Story = {
  render: () => <ProgressCourse />,
  play: async ({ canvasElement }) => {
    const programme = within(await openProgramme(canvasElement));
    await userEvent.click(
      programme.getByRole("button", { name: /^Глава 1 из 4/ }),
    );
    await expect(
      programme.getByRole("button", { name: /^4 главы · 8 из 20 пройдено/ }),
    ).toHaveAttribute("aria-expanded", "true");
    const chapters = within(
      programme.getByRole("navigation", { name: "Главы курса" }),
    );
    await expect(
      chapters.getByRole("button", {
        name: /^Глава 1 Подготовка.*вы здесь.*пройдено 8 из 13$/,
      }),
    ).toHaveAttribute("data-reading", "true");
    await expect(
      chapters.getByRole("button", { name: /^Глава 2 .*пройдено 0 из 3$/ }),
    ).toBeVisible();
  },
};

export const ReaderProgressOtherChapter: Story = {
  render: () => <ProgressCourse />,
  play: async ({ canvasElement }) => {
    const programme = within(await openProgramme(canvasElement));
    await userEvent.click(
      programme.getByRole("button", { name: /^Глава 1 из 4/ }),
    );
    await userEvent.click(
      programme.getByRole("button", { name: /^Глава 3 Релизы/ }),
    );
    await expect(programme.getByText("Вы читаете главу 1")).toBeVisible();
    await expect(programme.queryByRole("link", { current: "step" })).toBeNull();
    await userEvent.click(
      programme.getByRole("button", { name: "К текущему шагу" }),
    );
    await expect(
      programme.getByRole("link", { current: "step" }),
    ).toHaveAccessibleName("Выбор стека и границ модулей");
    await expect(programme.queryByText("Вы читаете главу 1")).toBeNull();
  },
};

export const ReaderProgressUnavailable: Story = {
  render: () => <ProgressCourse marks={new Map()} failed />,
  play: async ({ canvasElement }) => {
    const programme = within(await openProgramme(canvasElement));
    await expect(programme.queryByText(/пройдено/)).toBeNull();
    // A failed mark never reads as passed or unread; a saved submission is still known.
    for (const link of programme.getAllByRole("link"))
      if (link.dataset["courseStep"]?.startsWith("material:") === true)
        await expect(link).toHaveAttribute("data-progress", "unknown");
  },
};

export const ReaderProgressNarrowDesktop: Story = {
  ...ReaderProgress,
  globals: { viewport: { value: "desktop1036", isRotated: false } },
};

export const ReaderProgressTablet: Story = {
  ...ReaderProgress,
  globals: { viewport: { value: "tablet820", isRotated: false } },
};

export const ReaderProgressTabletChapters: Story = {
  ...ReaderProgressChapters,
  globals: { viewport: { value: "tablet820", isRotated: false } },
};

export const ReaderProgressPhone: Story = {
  ...ReaderProgress,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const ReaderProgressPhoneOtherChapter: Story = {
  ...ReaderProgressOtherChapter,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const DeferredTaskStatuses: Story = {
  render: function Deferred() {
    const [personal, setPersonal] = useState(false);
    return (
      <MaterialReadingScope
        value={{
          accountId: "story-account",
          resolved: true,
          failed: false,
          states: new Map(),
          register: () => () => undefined,
          refresh: () => Promise.resolve(),
        }}
      >
        <CourseReadingLayout context={withDeferredTaskStatuses(taskOnlyCourse)}>
          <button
            onClick={() => {
              setPersonal(true);
            }}
          >
            Получить личные статусы
          </button>
          {personal ? (
            <CourseTaskSubmissionStatuses
              courseHref={taskOnlyCourse.courseHref}
              submittedTaskIds={[taskOnlyCourse.current.id]}
            />
          ) : null}
        </CourseReadingLayout>
      </MaterialReadingScope>
    );
  },
  play: async ({ canvasElement }) => {
    const programme = within(await openProgramme(canvasElement));
    const task = programme.getByRole("link", { current: "step" });
    // Guest-cached composition says nothing about the reader's submission yet.
    await expect(task).toHaveAttribute("data-progress", "unknown");
    await expect(programme.queryByText(/пройдено/)).toBeNull();
    const dialog = canvasElement.querySelector("dialog[open]");
    if (dialog instanceof HTMLDialogElement) dialog.close();
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Получить личные статусы",
      }),
    );
    const programmeAfter = within(await openProgramme(canvasElement));
    await expect(
      programmeAfter.getByRole("link", { current: "step" }),
    ).toHaveAttribute("data-progress", "done");
  },
};

/** The dock names the programme and describes chapter progress on phones and tablets alike. */
async function expectLessonDock(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const dialog = canvasElement.querySelector("dialog[open]");
  if (dialog instanceof HTMLDialogElement) dialog.close();
  const navigation = canvas.getByRole("navigation", {
    name: "Навигация по урокам",
  });
  const opener = within(navigation).getByRole("button", {
    name: "Вся программа",
  });
  await expect(opener).toHaveAccessibleDescription("Пройдено 8 из 13");
  const bounds = navigation.getBoundingClientRect();
  await expect(bounds.left).toBeGreaterThanOrEqual(24);
  await expect(window.innerWidth - bounds.right).toBeGreaterThanOrEqual(24);
  await expect(bounds.width).toBeLessThanOrEqual(22 * 16);
}

export const LessonDockPhone: Story = {
  render: () => <ProgressCourse />,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expectLessonDock(canvasElement);
  },
};

export const LessonDockTablet: Story = {
  render: () => <ProgressCourse />,
  globals: { viewport: { value: "tablet820", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expectLessonDock(canvasElement);
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Вся программа" }),
    );
    const dialog = canvas.getByRole("dialog", {
      name: "Программа: AI Engineering",
    });
    // A tablet sheet fits the chapter instead of covering the page.
    await waitFor(async () => {
      await expect(dialog.getBoundingClientRect().height).toBeLessThan(
        window.innerHeight - 64,
      );
    });
  },
};
