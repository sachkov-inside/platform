import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use } from "react";
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
  ProductTaskNotFound,
  ProductTaskUnavailable,
} from "./product-task-states";
import { ProductTaskClosed, ProductTaskView } from "./product-task-view";

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
    learnerMcpUrl,
    page: openProductTask,
    returnTo,
    submissions: submittedTwice,
  },
} satisfies Meta<typeof ProductTaskView>;
export default meta;
type Story = StoryObj<typeof meta>;

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
      "Сдача",
      "Мои сдачи",
      "Материалы к заданию",
    ])
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    await expect(page.getByText(/^Сдано 5 октября$/u)).toBeVisible();
    await expect(page.getByText("Посмотрел автор 4 октября")).toBeVisible();
    await expect(
      page.getByText(/Версия требований 1 \(сейчас 2\)/u),
    ).toBeVisible();
    await expect(
      page.getByText(/Проверь моё задание aie-ch1-onboarding/u),
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
  render: () => <ProductTaskClosed task={closedProductTask} />,
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
      await expect(boxOf(canvasElement, "[data-task-return]")).toEqual(
        skeleton.returnRow,
      );
      await expect(
        originOf(boxOf(canvasElement, "[data-task-header]")),
      ).toEqual(originOf(skeleton.header));
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
      "/materials/synthetic-lesson",
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
      page
        .getByRole("navigation", { name: "Части задания" })
        .querySelector('a[href="#task-submit:page"]'),
    ).not.toBeNull();
    await expect(
      page.getByRole("region", { name: "Мои сдачи" }),
    ).toBeInTheDocument();
  },
};
