import { practiceReviewSetupText } from "@/features/learner-mcp";
import {
  variantDiagram,
  expectVariantDiagram,
} from "@/storybook/image-variants";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use, useState } from "react";
import { MaterialReadingScope } from "@/entities/material";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import {
  closedProductTask,
  learnerMcpUrl,
  notSubmittedYet,
  openProductTask,
  openFormatCTask,
  submittedTwice,
} from "@/storybook/product-task.fixtures";
import {
  boxOf,
  desktop,
  mobile,
  originOf,
  settleStoryFrame,
  stagedLoaders,
  stagedLoadingOf,
  type StagedLoading,
  type StoryViewport,
} from "@/storybook/loads-in-place";
import { withMutationFetch } from "@/storybook/mutation-mock";
import {
  publicPageEnvironment,
  PublicShellFrame,
  routeContent,
} from "@/storybook/story-environment";

import {
  ProductTaskLoading,
  ProductTaskPending,
  ProductTaskNotFound,
  ProductTaskUnavailable,
} from "./product-task-states";
import {
  ProductTaskClosed,
  ProductTaskView,
  type ProductTaskViewProps,
} from "./product-task-view";

import {
  courseTask,
  taskOnlyCourse,
} from "@/storybook/course-reading.fixtures";

const returnTo = "/products/ai-engineering/tasks/aie-ch1-onboarding";
const environment = publicPageEnvironment(returnTo);

const meta = {
  beforeEach: environment.beforeEach,
  // One public shell; a story names the account state its header shows.
  decorators: [
    (Story, context) => (
      <PublicShellFrame
        account={
          context.parameters["account"] === "guest" ? "guest" : "authenticated"
        }
        currentPath={returnTo}
      >
        <Story />
      </PublicShellFrame>
    ),
  ],
  component: ProductTaskView,
  title: "Pages/Product Task",
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Страница задания, вариант A «Документ», принятый владельцем 05.10.2026 (#947): части задания по порядку, блок «Сдача» с инструкцией и запасной формой, «Мои сдачи» и материалы.",
      },
    },
  },
  args: {
    programme: courseTask,
    liveSubmissions: false,
    learnerMcpUrl,
    page: openProductTask,
    returnTo,
    submissions: submittedTwice,
  },
} satisfies Meta<typeof ProductTaskView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CourseTaskOnly: Story = { args: { programme: taskOnlyCourse } };
export const CourseNavigationUnavailable: Story = {
  args: { programme: null, submissions: { kind: "unavailable" } },
};

/** Сданное дважды задание: последняя сдача по текущей версии, первая — с отзывом автора. */
export const Submitted: Story = {
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: openProductTask.task.title }),
    ).toBeVisible();
    for (const name of [
      "Ситуация",
      "Результат",
      "Обязательно",
      "Дополнительно",
      "Свобода",
      "Сдача задания",
      "Мои сдачи",
      "Материалы к заданию",
    ])
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    const submission =
      canvasElement.querySelector<HTMLElement>('[id="task-submit"]');
    if (submission === null) throw new Error("Missing submission section");
    await expect(
      within(submission).getAllByText("Сдача отправлена"),
    ).toHaveLength(2);
    const header =
      canvasElement.querySelector<HTMLElement>("[data-task-header]");
    if (header === null) throw new Error("Missing task header");
    await expect(
      within(header).queryByText(/Требования: версия|Ещё не сдано|Сдано/u),
    ).toBeNull();
    await expect(
      within(header).queryByText("Задание", { exact: true }),
    ).toBeNull();
    await expect(
      within(header).queryByRole("link", { name: "Сдать" }),
    ).toBeNull();
    await expect(page.getByText("Посмотрел автор 4 октября")).toBeVisible();
    await expect(
      page.getByText(/Версия требований 1 \(сейчас 2\)/u),
    ).toBeVisible();
    await expect(
      page.getByText(/Проверь моё задание aie-ch1-onboarding/u),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Скопировать запрос" }),
    ).toBeVisible();
  },
};

/** Вошедший ученик ещё не сдавал: статус «Ещё не сдано» и пустая лента. */
export const FirstTime: Story = {
  args: { submissions: notSubmittedYet },
};

/** Гость читает бесплатное задание; форма и «Мои сдачи» приглашают войти. */
export const Guest: Story = {
  parameters: { account: "guest" },
  args: { submissions: { kind: "guest" } },
};

/** Приём сдач выключен до политики данных v4: инструкция видна, отправка закрыта. */
export const SubmissionsClosed: Story = {
  args: {
    page: { ...openProductTask, submission: { accepting: false } },
    submissions: notSubmittedYet,
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      page.getByText("Нет агента с MCP? Сдать через форму"),
    );
    await expect(
      page.getByRole("button", { name: "Отправить сдачу" }),
    ).toBeDisabled();
  },
};

const submitSpy = fn((input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(
    (input instanceof Request ? input.url : input.toString()).endsWith(
      "/api/product-tasks/submissions",
    )
      ? Response.json({
          kind: "submitted",
          submittedAt: "2026-10-05T16:40:00.000Z",
        })
      : new Response(null, { status: 404 }),
  ),
);

/** Запасная форма отправляет заметку, репозиторий и отчёт; ветку и commit ученик не вводит. */
export const FormSubmits: Story = {
  args: { submissions: notSubmittedYet },
  decorators: [withMutationFetch(submitSpy)],
  play: async ({ canvasElement }) => {
    submitSpy.mockClear();
    const page = routeContent(canvasElement);
    await userEvent.click(
      page.getByText("Нет агента с MCP? Сдать через форму"),
    );
    await expect(page.queryByLabelText(/Ветка|Commit/u)).toBeNull();
    await userEvent.type(
      page.getByLabelText(/Репозиторий/u),
      "https://github.com/learner/devportal",
    );
    await userEvent.type(
      page.getByLabelText(/Заметка для автора/u),
      "Сделал выдачу доступа.",
    );
    await userEvent.click(
      page.getByRole("button", { name: "Отправить сдачу" }),
    );
    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    const body = submitSpy.mock.calls[0]?.[1]?.body;
    if (!(body instanceof FormData)) throw new Error("Форма не отправлена");
    await expect(Object.fromEntries(body)).toMatchObject({
      code: "aie-ch1-onboarding",
      taskVersion: "2",
      note: "Сделал выдачу доступа.",
      repositoryUrl: "https://github.com/learner/devportal",
    });
    await expect(
      await page.findByText("Сдача отправлена. Она появилась в «Моих сдачах»."),
    ).toBeVisible();
  },
};

/** Сдачи не загрузились, а само задание читается. */
export const SubmissionsUnavailable: Story = {
  args: { submissions: { kind: "unavailable" } },
};

/** Платное задание без доступа: только название и глава, как закрытый материал. */
export const Closed: Story = {
  render: () => (
    <ProductTaskClosed task={closedProductTask} programme={courseTask} />
  ),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: closedProductTask.title }),
    ).toBeVisible();
    await expect(page.queryByText("Ситуация")).toBeNull();
    await expect(
      page.getByRole("link", { name: /К программе и оплате/u }),
    ).toHaveAttribute("href", "/products/ai-engineering/programme");
  },
};

export const NotFound: Story = { render: () => <ProductTaskNotFound /> };

export const Unavailable: Story = { render: () => <ProductTaskUnavailable /> };

function StagedTask({ sequence }: { readonly sequence: StagedLoading }) {
  return (
    <Suspense fallback={<ProductTaskLoading />}>
      <ReadyTask sequence={sequence} />
    </Suspense>
  );
}

function ReadyTask({ sequence }: { readonly sequence: StagedLoading }) {
  use(sequence.personalPart);
  return (
    <ProductTaskView
      learnerMcpUrl={learnerMcpUrl}
      page={openProductTask}
      returnTo={returnTo}
      submissions={submittedTwice}
    />
  );
}

/** Скелет держит ряд возврата и начало шапки там же, где их рисует готовая страница. */
function loadsInPlace({
  globals,
  width,
}: StoryViewport): Pick<Story, "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    loaders: stagedLoaders,
    render: (_args, { loaded }) => (
      <StagedTask sequence={stagedLoadingOf(loaded)} />
    ),
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const sequence = stagedLoadingOf(loaded);
      const canvas = within(canvasElement);
      await expect(
        await canvas.findByLabelText("Задание загружается"),
      ).toHaveAttribute("aria-busy", "true");
      const skeleton = {
        returnRow: boxOf(canvasElement, "[data-task-return]"),
        header: boxOf(canvasElement, "[data-task-header]"),
      };
      sequence.deliverSharedPart();
      sequence.deliverPersonalPart();
      await canvas.findByRole("heading", {
        level: 1,
        name: openProductTask.task.title,
      });
      const readyReturn = boxOf(canvasElement, "[data-task-return]");
      await expect(originOf(readyReturn)).toEqual(originOf(skeleton.returnRow));
      await expect(readyReturn.width).toBe(skeleton.returnRow.width);
      await expect(
        boxOf(canvasElement, "[data-task-header]").top,
      ).toBeGreaterThanOrEqual(readyReturn.top + readyReturn.height);
    },
  };
}

export const LoadsInPlace: Story = { ...loadsInPlace(desktop) };
export const LoadsInPlaceMobile: Story = { ...loadsInPlace(mobile) };

/** A complete synthetic c page keeps its Markdown and folds advice; agent evidence never enters the reader. */
export const FormatC: Story = {
  args: { page: openFormatCTask, submissions: notSubmittedYet },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Задание 1. Собери учебный проект",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Что нужно сделать" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Что решаешь сам" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /^урок$/u })).toHaveAttribute(
      "href",
      "/materials/synthetic-lesson?from=%2Fproducts%2Fai-engineering%2Fprogramme&anchor=task%3Asynthetic-c-task",
    );
    await expect(page.queryByText("Чем подтвердить")).toBeNull();
    await expect(
      page.getAllByRole("heading", { level: 2, name: "Материалы к заданию" }),
    ).toHaveLength(1);
    const advice = page
      .getByText("Мой совет", { exact: true })
      .closest("summary");
    if (advice === null)
      throw new Error("Task advice must use a native summary.");
    await expect(page.getByText("Начни с одного запроса.")).not.toBeVisible();
    await userEvent.click(advice);
    await expect(page.getByText("Начни с одного запроса.")).toBeVisible();
    await userEvent.click(advice);
    await expect(page.getByText("Начни с одного запроса.")).not.toBeVisible();
    const image = page.getByRole("img", { name: "Схема учебного проекта" });
    await expect(image).toBeVisible();
    await waitFor(async () => {
      await expect(image).toHaveProperty("complete", true);
      await expect(image).not.toHaveProperty("naturalWidth", 0);
    });
  },
};

export const FormatCMobile: Story = {
  ...FormatC,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const SourceAnchors: Story = {
  args: {
    submissions: notSubmittedYet,
    page: {
      ...openFormatCTask,
      task: {
        ...openFormatCTask.task,
        page: {
          title: "Задание с исходными якорями",
          summary: "Синтетическая проверка навигации Content.",
          cover: null,
          artifacts: [],
          body: {
            schemaVersion: 1,
            blocks: [
              {
                kind: "heading",
                level: 2,
                content: [
                  {
                    kind: "text",
                    text: "Как спроектировать один этап?",
                    marks: [],
                  },
                ],
              },
              {
                kind: "heading",
                level: 2,
                content: [{ kind: "text", text: "task-submit", marks: [] }],
              },
              {
                kind: "heading",
                level: 2,
                content: [{ kind: "text", text: "task-mine", marks: [] }],
              },
              {
                kind: "heading",
                level: 2,
                content: [
                  { kind: "text", text: "task-mine-heading", marks: [] },
                ],
              },
            ],
          },
        },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Как спроектировать один этап?" }),
    ).toHaveAttribute("id", "как-спроектировать-один-этап");
    await expect(
      canvasElement.querySelectorAll('[id="task-section-0"]'),
    ).toHaveLength(1);
    await expect(
      page.getByRole("heading", { name: /^task-submit$/u }),
    ).toHaveAttribute("id", "task-submit");
    const ids = Array.from(canvasElement.querySelectorAll("[id]")).map(
      (node) => node.id,
    );
    await expect(new Set(ids).size).toBe(ids.length);
    await expect(
      canvasElement.querySelector('[id="task-submit:page"]'),
    ).not.toBeNull();
    await expect(
      canvasElement.querySelector(
        '[data-course-actions] a[href="#task-submit:page"]',
      ),
    ).toBeNull();
    await expect(
      page.getByRole("region", { name: "Мои сдачи" }),
    ).toBeInTheDocument();
  },
};

export const ImageVariants: Story = {
  args: {
    page: {
      ...openFormatCTask,
      task: {
        ...openFormatCTask.task,
        page: {
          title: "Задание со схемой",
          summary: "Варианты схемы",
          cover: null,
          artifacts: [],
          body: {
            schemaVersion: 1,
            blocks: [
              {
                kind: "heading",
                level: 2,
                content: [{ kind: "text", text: "Схема решения", marks: [] }],
              },
              variantDiagram,
            ],
          },
        },
      },
    },
    submissions: notSubmittedYet,
  },
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => expectVariantDiagram(canvasElement, false),
};
export const ImageVariantsMobile: Story = {
  ...ImageVariants,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => expectVariantDiagram(canvasElement, true),
};

/** Personal requirements must not hide the prefetched course title and navigation. */
export const PersonalTaskPending: Story = {
  render: () => <ProductTaskPending programme={courseTask} />,
  parameters: { account: "guest" },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("heading", { level: 1 })).toHaveTextContent(
      courseTask.current.title,
    );
    await expect(
      within(
        page.getByRole("navigation", { name: "Хлебные крошки" }),
      ).getByRole("link", { name: "AI Engineering" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: "Задание загружается" }),
    ).toBeVisible();
    await expect(
      canvasElement.querySelector('[data-product-task-state="loading"]'),
    ).toBeNull();
    await expect(
      canvasElement.querySelector("[data-product-task-form]"),
    ).toBeNull();
  },
};

function ReadyCourseTask({ sequence }: { readonly sequence: StagedLoading }) {
  use(sequence.personalPart);
  return (
    <ProductTaskView
      learnerMcpUrl={learnerMcpUrl}
      page={openProductTask}
      programme={courseTask}
      returnTo={returnTo}
      submissions={submittedTwice}
    />
  );
}

function courseLoadsInPlace({
  globals,
  width,
}: StoryViewport): Pick<Story, "globals" | "loaders" | "render" | "play"> {
  return {
    globals,
    loaders: stagedLoaders,
    render: (_args, { loaded }) => (
      <Suspense fallback={<ProductTaskPending programme={courseTask} />}>
        <ReadyCourseTask sequence={stagedLoadingOf(loaded)} />
      </Suspense>
    ),
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const canvas = within(canvasElement);
      await canvas.findByRole("status", { name: "Задание загружается" });
      const navigation =
        width === mobile.width
          ? '[aria-label="Навигация по урокам"]'
          : '[aria-label="Текущая глава"]';
      const before = {
        header: originOf(boxOf(canvasElement, "[data-task-header]")),
        navigation: boxOf(canvasElement, navigation),
        title: boxOf(canvasElement, "[data-reader-header] h1"),
      };
      stagedLoadingOf(loaded).deliverPersonalPart();
      await canvas.findByRole("heading", { name: "Мои сдачи" });
      await expect(
        originOf(boxOf(canvasElement, "[data-task-header]")),
      ).toEqual(before.header);
      await expect(boxOf(canvasElement, navigation)).toEqual(before.navigation);
      await expect(boxOf(canvasElement, "[data-reader-header] h1")).toEqual(
        before.title,
      );
    },
  };
}

export const CourseLoadsInPlace: Story = { ...courseLoadsInPlace(desktop) };
export const CourseLoadsInPlaceMobile: Story = {
  ...courseLoadsInPlace(mobile),
};

/** The existing Material store supplies known read/unread values and announces changed values to related links. */
function RelatedProgressTask(
  props: ProductTaskViewProps & { readonly unknown?: boolean },
) {
  const [readSecond, setReadSecond] = useState(false);
  const states = new Map(
    props.unknown === true
      ? []
      : props.page.relatedMaterials.map((material, index) => [
          material.materialId,
          { isRead: index === 0 || readSecond, version: readSecond ? 2 : 1 },
        ]),
  );
  return (
    <MaterialReadingScope
      value={{
        accountId: "story-account",
        resolved: true,
        failed: props.unknown === true,
        states,
        register: () => () => undefined,
        refresh: () => Promise.resolve(),
      }}
    >
      <ProductTaskView {...props} />
      {props.unknown === true ? null : (
        <button
          type="button"
          onClick={() => {
            setReadSecond(true);
          }}
        >
          Обновить прогресс
        </button>
      )}
    </MaterialReadingScope>
  );
}

export const RelatedMaterialsProgress: Story = {
  render: (args) => <RelatedProgressTask {...args} />,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const related = canvasElement.querySelector<HTMLElement>(
      '[aria-labelledby="task-related-heading"]',
    );
    if (related === null) throw new Error("Missing related Materials");
    await expect(
      within(related).getByText("Изучено", { exact: true }),
    ).toBeInTheDocument();
    await expect(
      within(related).getByText("Не изучено", { exact: true }),
    ).toBeInTheDocument();
    const condition = page.getByRole("heading", {
      name: "Ситуация",
    });
    await expect(related.getBoundingClientRect().top).toBeLessThan(
      condition.getBoundingClientRect().top,
    );
    await expect(
      within(related).getByRole("link", { name: /MCP: клиент/u }),
    ).toHaveAttribute("href", expect.stringContaining("from=%2Fproducts%2F"));
    await userEvent.click(
      page.getByRole("button", { name: "Обновить прогресс" }),
    );
    await expect(
      within(related).getAllByText("Изучено", { exact: true }),
    ).toHaveLength(2);
    await expect(
      within(related).queryByText("Не изучено", { exact: true }),
    ).toBeNull();
  },
};
export const RelatedMaterialsProgressMobile: Story = {
  ...RelatedMaterialsProgress,
  globals: mobile.globals,
};

export const RelatedMaterialsProgressUnavailable: Story = {
  render: (args) => <RelatedProgressTask {...args} unknown />,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getAllByText("Прогресс недоступен", { exact: true }),
    ).toHaveLength(2);
    await expect(page.queryByText("Не изучено", { exact: true })).toBeNull();
  },
};

function olderHistory() {
  if (submittedTwice.kind !== "ready")
    throw new Error("Expected submitted fixture");
  const oldest = submittedTwice.submissions.at(-1);
  if (oldest === undefined) throw new Error("Expected oldest attempt");
  return {
    ...submittedTwice,
    continued: true,
    nextCursor: "opaque-older",
    submissions: [oldest],
  };
}

export const OlderAttempts: Story = {
  args: { submissions: olderHistory() },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("link", { name: "Предыдущие сдачи" }),
    ).toHaveAttribute(
      "href",
      `${returnTo}?attemptsAfter=opaque-older#task-mine`,
    );
    await expect(
      page.getByRole("link", { name: "К новым сдачам" }),
    ).toHaveAttribute("href", `${returnTo}#task-mine`);
    await expect(
      page.getByText("Сдача отправлена", { exact: true }),
    ).toBeVisible();
  },
};

const agentReport = {
  summary:
    "Основной сценарий работает. Нужно проверить отзыв доступа и уточнить обработку отказа GitHub.",
  criteria: openProductTask.task.definition.criteria.map(
    (criterion, index) => ({
      criterionId: criterion.id,
      status:
        index === 1
          ? ("violation" as const)
          : index === 2
            ? ("not_verified" as const)
            : ("confirmed" as const),
      evidence:
        index === 1
          ? "В обработчике запроса не найдено проверки владельца."
          : "Проверены файлы проекта и сохранённый отчёт тестов.",
      gap:
        index === 1
          ? "Добавить проверку владельца перед чтением проекта."
          : index === 2
            ? "Нет сохранённого ответа GitHub."
            : "",
      obtainedByRun: false,
    }),
  ),
};
const reviewHistory = {
  kind: "ready" as const,
  code: openProductTask.task.code,
  currentVersion: openProductTask.task.version,
  nextCursor: null,
  latestSubmittedAt: null,
  submissions: [],
  versions: [
    {
      version: openProductTask.task.version,
      criteria: openProductTask.task.definition.criteria,
    },
  ],
  reviewProgress: {
    taskVersion: openProductTask.task.version,
    runKey: "74000000-0000-4000-8000-000000000001",
    revision: 2,
    phase: "ready" as const,
    summary: "Проверка завершена. Обсуди замечания и отправку с агентом.",
    reviewReport: agentReport,
    updatedAt: "2026-10-15T08:30:00.000Z",
  },
};
export const ReviewReady: Story = {
  args: { submissions: reviewHistory },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByText("Отчёт готов — обсуди его с агентом"),
    ).toBeVisible();
    await expect(page.getByText(/Ещё не отправлено/u)).toBeVisible();
    await userEvent.click(
      page.getByText("Отчёт по критериям", { exact: true }),
    );
    await expect(
      page.getByText("Добавить проверку владельца перед чтением проекта.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.queryByText("Сдача отправлена", { exact: true }),
    ).toBeNull();
  },
};
export const ReviewReadyMobile: Story = {
  ...ReviewReady,
  globals: mobile.globals,
};
export const ReviewInProgress: Story = {
  args: {
    submissions: {
      ...reviewHistory,
      reviewProgress: {
        ...reviewHistory.reviewProgress,
        phase: "reviewing",
        reviewReport: null,
        summary: "Читаю проект и сверяю права доступа.",
      },
    },
  },
};
export const ReviewStopped: Story = {
  args: {
    submissions: {
      ...reviewHistory,
      reviewProgress: {
        ...reviewHistory.reviewProgress,
        phase: "stopped",
        reviewReport: null,
        summary: "Не удалось прочитать отчёт CI. Продолжи проверку у агента.",
      },
    },
  },
};
export const SavedAgentReport: Story = {
  args: {
    submissions: {
      ...reviewHistory,
      reviewProgress: null,
      latestSubmittedAt: "2026-10-15T08:35:00.000Z",
      submissions: [
        {
          submissionId: "75000000-0000-4000-8000-000000000001",
          taskVersion: openProductTask.task.version,
          source: "mcp",
          submittedAt: "2026-10-15T08:35:00.000Z",
          note: "Реализовал основной сценарий. Следующим шагом исправлю проверку владельца.",
          reportText: null,
          repositoryUrl: "https://github.com/learner/devportal",
          reviewReport: agentReport,
          authorFeedback: {
            comment:
              "Проверь доступ с двумя аккаунтами и повтори самопроверку.",
            reviewedAt: null,
          },
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByText("Комментарий автора", { exact: true }),
    ).toBeVisible();
    await expect(page.queryByText("Автор ещё не смотрел.")).toBeNull();
    await expect(
      page.getByText("Сдача отправлена", { exact: true }),
    ).toBeVisible();
  },
};

/** The task keeps setup on the same page; the agent receives the identical canonical text. */
export const ConnectionHelp: Story = {
  args: { submissions: notSubmittedYet },
  decorators: [
    withMutationFetch((input) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (path.endsWith("/practice-review-setup.txt"))
        return Promise.resolve(
          new Response(
            practiceReviewSetupText({
              url: learnerMcpUrl,
              publicClientId: "storybook_public_client",
            }),
            { headers: { "content-type": "text/plain; charset=utf-8" } },
          ),
        );
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  ],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      page.getByText("Подключить учебный MCP", { exact: true }),
    );
    await expect(
      page.getByRole("button", { name: "Скопировать запрос подключения" }),
    ).toBeVisible();
    await userEvent.click(
      page.getByText("Подробная инструкция и помощь", { exact: true }),
    );
    await userEvent.click(await page.findByText("Codex", { exact: true }));
    await expect(
      page.getByText(/codex mcp login inside_learning/u),
    ).toBeVisible();
    await expect(
      page.queryByRole("link", { name: "Инструкция подключения" }),
    ).not.toBeInTheDocument();
  },
};

export const RequirementsChangedDuringReview: Story = {
  args: {
    submissions: {
      ...reviewHistory,
      currentVersion: openProductTask.task.version + 1,
    },
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByText(
        "Требования обновились. Обнови задание перед следующей сдачей.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Обновить задание" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Требования изменились. Попроси агента проверить работу заново.",
      ),
    ).toBeVisible();
  },
};
