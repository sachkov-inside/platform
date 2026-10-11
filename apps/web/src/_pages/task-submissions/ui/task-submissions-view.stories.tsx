import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import {
  TaskSubmissionsLoading,
  TaskSubmissionsRuntime,
  TaskSubmissionsState,
  TaskSubmissionsView,
} from "@/_pages/task-submissions";
import { presentTaskSubmissions } from "../model/task-submissions-presentation";
import { withMutationFetch } from "@/storybook/mutation-mock";
import { Button } from "@/shared/ui/button";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";
import {
  reviewedSubmissions,
  submissionsProductId,
  submissionsSecondChapter,
} from "@/storybook/task-submissions.fixtures";
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

const environment = authoringPageEnvironment("/authoring/submissions");
const presentation = presentTaskSubmissions({
  submissions: reviewedSubmissions,
  selection: {},
  continued: false,
});
const meta = {
  ...environment,
  title: "Pages/Authoring/Task submissions",
  component: TaskSubmissionsView,
  decorators: [
    (Story) => (
      <TaskSubmissionsRuntime>
        <Story />
      </TaskSubmissionsRuntime>
    ),
    ...environment.decorators,
  ],
  args: { presentation },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Окончательный раздел «Сдачи» (#967), принятый вариант A: очередь слева и один полный отчёт справа; на телефоне последовательно. Общий production-модуль, штатная mutation отзыва и синтетические fixture-данные.",
      },
    },
  },
} satisfies Meta<typeof TaskSubmissionsView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Submissions: Story = {
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Сдачи" }),
    ).toBeVisible();
    const queue = within(page.getByRole("region", { name: "Очередь сдач" }));
    await expect(queue.getAllByRole("button")).toHaveLength(3);
    await expect(page.getAllByRole("article")).toHaveLength(1);
    await expect(page.getByText("telegram:synthetic-01")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "https://github.com/learner/devportal" }),
    ).toHaveAttribute("rel", "noopener noreferrer nofollow");
    await expect(
      page.getByText(/commit 4f2a9c1, есть незакоммиченные изменения/u),
    ).toBeVisible();
    await userEvent.click(queue.getAllByRole("button")[2] ?? canvasElement);
    await expect(
      page.getByText("Версия требований 1 (сейчас 2)"),
    ).toBeVisible();
    await expect(page.getByText("Без заметки")).toBeVisible();
    await userEvent.click(page.getByText("Критерии версии 1"));
    await expect(
      page.queryByText("Второй агент проверяет выдачу."),
    ).not.toBeInTheDocument();
  },
};

export const SelectionKeepsDrafts: Story = {
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const queue = within(page.getByRole("region", { name: "Очередь сдач" }));
    const choices = queue.getAllByRole("button");
    await userEvent.type(
      page.getByRole("textbox", { name: /Комментарий для ученика/u }),
      "Черновик для онбординга",
    );
    await userEvent.click(choices[1] ?? canvasElement);
    await expect(
      page.getByText(
        "Проверил сам: заявка создаётся, повтор не создаёт вторую.",
      ),
    ).toBeVisible();
    const second = page.getByRole("textbox", {
      name: /Комментарий для ученика/u,
    });
    await userEvent.clear(second);
    await userEvent.type(second, "Черновик для заявок");
    await userEvent.click(choices[0] ?? canvasElement);
    await expect(
      page.getByRole("textbox", { name: /Комментарий для ученика/u }),
    ).toHaveValue("Черновик для онбординга");
    await userEvent.click(choices[1] ?? canvasElement);
    await expect(
      page.getByRole("textbox", { name: /Комментарий для ученика/u }),
    ).toHaveValue("Черновик для заявок");
  },
};

export const ReportIsText: Story = {
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByText(/<img src=x onerror="alert\(1\)"> Роль читается/u),
    ).toBeVisible();
    await expect(canvasElement.querySelector("img[src='x']")).toBeNull();
    await expect(page.getByText("Нарушение")).toBeVisible();
    await expect(
      page.getByText("Обязательно · получено запуском"),
    ).toBeVisible();
    await userEvent.click(page.getByText("Критерии версии 2"));
    await expect(
      page.getAllByText("Второй агент проверяет выдачу."),
    ).toHaveLength(2);
  },
};

const savedFeedback = {
  comment: "Проверку роли перенеси на сервер.",
  reviewedAt: "2026-10-05T17:00:00.000Z",
  updatedAt: "2026-10-05T17:00:00.000Z",
};
const saveSpy = fn((_input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(
    Response.json({ kind: "saved", authorFeedback: savedFeedback }),
  ),
);

export const FeedbackSaves: Story = {
  decorators: [withMutationFetch(saveSpy)],
  play: async ({ canvasElement }) => {
    saveSpy.mockClear();
    const page = routeContent(canvasElement);
    const save = page.getByRole("button", { name: "Сохранить отзыв" });
    await expect(save).toBeDisabled();
    await userEvent.click(
      page.getByRole("checkbox", { name: "Посмотрел автор" }),
    );
    await userEvent.type(
      page.getByRole("textbox", { name: /Комментарий для ученика/u }),
      "Проверку роли перенеси на сервер.",
    );
    await userEvent.click(save);
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const init = saveSpy.mock.calls[0]?.[1];
    await expect(init?.method).toBe("PUT");
    const body = init?.body;
    if (!(body instanceof FormData)) throw new Error("Отзыв не отправлен");
    await expect(Object.fromEntries(body)).toEqual({
      submissionId: "30000000-0000-4000-8000-000000000003",
      comment: "Проверку роли перенеси на сервер.",
      reviewed: "true",
    });
    await expect(
      await page.findByText(
        "Сохранено. Ученик увидит отзыв на странице задания.",
      ),
    ).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(
      within(page.getByRole("region", { name: "Очередь сдач" })).getAllByRole(
        "button",
      )[0],
    ).toHaveTextContent("Посмотрел автор");
  },
};

export const FeedbackSaveFails: Story = {
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(Response.json({ kind: "unavailable" })),
    ),
  ],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.type(
      page.getByRole("textbox", { name: /Комментарий для ученика/u }),
      "Не потеряй этот отзыв",
    );
    await userEvent.click(
      page.getByRole("button", { name: "Сохранить отзыв" }),
    );
    await expect(await page.findByRole("alert")).toHaveTextContent(
      "Не удалось сохранить",
    );
    await expect(
      page.getByRole("textbox", { name: /Комментарий для ученика/u }),
    ).toHaveValue("Не потеряй этот отзыв");
    await expect(
      page.getByRole("button", { name: "Сохранить отзыв" }),
    ).toBeEnabled();
  },
};

export const ExpiredSession: Story = {
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(new Response(null, { status: 401 })),
    ),
  ],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.type(
      page.getByRole("textbox", { name: /Комментарий для ученика/u }),
      "Черновик при истёкшей сессии",
    );
    await userEvent.click(
      page.getByRole("button", { name: "Сохранить отзыв" }),
    );
    await expect(await page.findByRole("alert")).toHaveTextContent(
      "Сессия закончилась",
    );
    await expect(
      page.getByRole("textbox", { name: /Комментарий для ученика/u }),
    ).toHaveValue("Черновик при истёкшей сессии");
  },
};

export const FilteredByChapter: Story = {
  args: {
    presentation: presentTaskSubmissions({
      continued: false,
      selection: {
        productId: submissionsProductId,
        chapterId: submissionsSecondChapter,
      },
      submissions: {
        ...reviewedSubmissions,
        submissions: reviewedSubmissions.submissions.filter(
          (item) => item.task.chapterId === submissionsSecondChapter,
        ),
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("combobox", { name: "Глава" })).toHaveValue(
      submissionsSecondChapter,
    );
    const task = page.getByRole("combobox", { name: "Задание" });
    await expect(
      within(task)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Все задания", "Заявки клиентов"]);
    await userEvent.selectOptions(
      page.getByRole("combobox", { name: "Продукт" }),
      "",
    );
    await expect(page.getByRole("combobox", { name: "Глава" })).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "Глава" })).toBeDisabled();
    await expect(task).toHaveValue("");
  },
};

export const Paged: Story = {
  args: {
    presentation: presentTaskSubmissions({
      continued: true,
      cursor: "page-2",
      selection: {},
      submissions: { ...reviewedSubmissions, nextCursor: "next-page" },
    }),
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("link", { name: "Более ранние сдачи" }),
    ).toHaveAttribute("href", "/authoring/submissions?cursor=next-page");
    await expect(
      page.getByRole("link", { name: "К новым сдачам" }),
    ).toHaveAttribute("href", "/authoring/submissions");
  },
};

export const Empty: Story = {
  args: { presentation: { ...presentation, rows: [] } },
};
export const EmptyFilter: Story = {
  args: {
    presentation: {
      ...presentation,
      selection: { productId: submissionsProductId },
      rows: [],
    },
  },
};
export const Loading: Story = { render: () => <TaskSubmissionsLoading /> };
export const Forbidden: Story = {
  render: () => <TaskSubmissionsState kind="forbidden" />,
};
export const Unauthorized: Story = {
  render: () => <TaskSubmissionsState kind="unauthorized" />,
};
export const Unavailable: Story = {
  render: () => <TaskSubmissionsState kind="unavailable" />,
};

function ArrivedSubmissions({
  sequence,
}: {
  readonly sequence: StagedLoading;
}) {
  use(sequence.sharedPart);
  return <TaskSubmissionsView presentation={presentation} />;
}

function loadsInPlace({ globals, width }: StoryViewport): Story {
  return {
    globals,
    loaders: stagedLoaders,
    render: (_args, { loaded }) => (
      <Suspense fallback={<TaskSubmissionsLoading />}>
        <ArrivedSubmissions sequence={stagedLoadingOf(loaded)} />
      </Suspense>
    ),
    play: async ({ canvasElement, loaded }) => {
      await settleStoryFrame(width);
      const page = routeContent(canvasElement);
      await expect(
        page.getByRole("status", { name: "Загружаем сдачи" }),
      ).toBeVisible();
      const anchors = () =>
        ["title", "filter", "workspace"].map((part) =>
          originOf(boxOf(canvasElement, `[data-submissions-part='${part}']`)),
        );
      const loading = anchors();
      stagedLoadingOf(loaded).deliverSharedPart();
      await within(canvasElement).findByRole("region", {
        name: "Очередь сдач",
      });
      await expect(anchors()).toEqual(loading);
    },
  };
}
export const LoadsInPlace: Story = loadsInPlace(desktop);
export const LoadsInPlaceMobile: Story = loadsInPlace(mobile);

/** RSC reads can arrive out of order after navigating between filtered pages. */
function FeedbackSnapshots() {
  const [snapshot, setSnapshot] = useState(1);
  const incoming = presentTaskSubmissions({
    continued: false,
    selection: {},
    submissions: {
      ...reviewedSubmissions,
      submissions: reviewedSubmissions.submissions.slice(0, 1).map((row) => ({
        ...row,
        authorFeedback: {
          comment: `Серверный отзыв ${String(snapshot)}`,
          reviewedAt: null,
          updatedAt: `2026-10-11T09:0${String(snapshot)}:00.000Z`,
        },
      })),
    },
  });
  return (
    <div className="h-full min-h-0">
      <Button
        onClick={() => {
          setSnapshot(3);
        }}
      >
        Свежий серверный ответ
      </Button>
      <Button
        onClick={() => {
          setSnapshot(2);
        }}
      >
        Запоздалый серверный ответ
      </Button>
      <TaskSubmissionsView presentation={incoming} />
    </div>
  );
}
export const FreshFeedbackSurvivesStaleRead: Story = {
  render: () => <FeedbackSnapshots />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const comment = canvas.getByRole("textbox", {
      name: /Комментарий для ученика/u,
    });
    await userEvent.clear(comment);
    await userEvent.type(comment, "Серверный отзыв 1");
    await userEvent.click(
      canvas.getByRole("button", { name: "Свежий серверный ответ" }),
    );
    await expect(comment).toHaveValue("Серверный отзыв 3");
    await userEvent.click(
      canvas.getByRole("button", { name: "Запоздалый серверный ответ" }),
    );
    await expect(comment).toHaveValue("Серверный отзыв 3");
  },
};
