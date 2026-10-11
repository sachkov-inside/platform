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
import type { TaskSubmissions } from "../model/task-submissions";
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
const firstId = "30000000-0000-4000-8000-000000000003";
function detail(
  submissionId = firstId,
  source: TaskSubmissions = reviewedSubmissions,
) {
  const selected = source.submissions.find(
    (row) => row.submissionId === submissionId,
  );
  return presentTaskSubmissions({
    submissions: {
      ...source,
      submissions: source.submissions.filter(
        (row) => row.submissionId === submissionId,
      ),
      history: source.submissions
        .filter(
          (row) =>
            row.task.code === selected?.task.code &&
            row.person.accountId === selected.person.accountId &&
            row.selfCheck !== null,
        )
        .flatMap((row) =>
          row.selfCheck === null
            ? []
            : [
                {
                  submissionId: row.submissionId,
                  submittedAt: row.submittedAt,
                  taskVersion: row.taskVersion,
                  summary: row.reviewReport?.summary ?? null,
                  selfCheck: row.selfCheck,
                },
              ],
        ),
    },
    selection: {},
    continued: false,
    submissionId,
  });
}
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
          "Принятая композиция A для #1351: список и отдельная страница сдачи. Production и Storybook используют один модуль. Контакты и отчёты в Storybook вымышлены.",
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
    await expect(
      within(
        page.getByRole("list", { name: "Сдачи, новые сверху" }),
      ).getAllByRole("link"),
    ).toHaveLength(3);
    await expect(page.queryByRole("article")).not.toBeInTheDocument();
    await expect(page.getAllByText("Анна Смирнова")).toHaveLength(2);
    await userEvent.type(page.getByRole("searchbox"), "Марк");
    await expect(
      within(
        page.getByRole("list", { name: "Сдачи, новые сверху" }),
      ).getAllByRole("link"),
    ).toHaveLength(1);
    await userEvent.clear(page.getByRole("searchbox"));
    await userEvent.selectOptions(
      page.getByRole("combobox", { name: /Результат проверки/u }),
      "changes",
    );
    await expect(
      within(
        page.getByRole("list", { name: "Сдачи, новые сверху" }),
      ).getAllByRole("link"),
    ).toHaveLength(1);
  },
};
export const Submission: Story = {
  args: { presentation: detail() },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Онбординг команды" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "@anna_example" }),
    ).toHaveAttribute("href", "https://t.me/anna_example");
    await expect(page.getByRole("link", { name: "Все сдачи" })).toHaveAttribute(
      "href",
      "/authoring/submissions",
    );
    await expect(page.getByText(/Роль приходит от клиента/u)).not.toBeVisible();
  },
};
export const ExpandedSubmission: Story = {
  args: { presentation: detail(), expanded: true },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByText(/<img src=x onerror/u)).toBeVisible();
    await expect(canvasElement.querySelector("img[src='x']")).toBeNull();
    await expect(page.getByText("Нарушение")).toBeVisible();
  },
};
const passedSource: TaskSubmissions = {
  ...reviewedSubmissions,
  submissions: reviewedSubmissions.submissions.map((row) =>
    row.submissionId !== firstId
      ? row
      : {
          ...row,
          selfCheck: { outcome: "passed", attempt: 2, firstPassedAttempt: 2 },
          reviewReport:
            row.reviewReport === null
              ? null
              : {
                  ...row.reviewReport,
                  summary:
                    "Доступ выдаёт только руководитель команды. Все обязательные критерии подтверждены.",
                  criteria: row.reviewReport.criteria.map((item) => ({
                    ...item,
                    status: "confirmed",
                    gap: "",
                  })),
                },
        },
  ),
};
export const Passed: Story = {
  args: { presentation: detail(firstId, passedSource) },
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByText(
        "Первая успешная самопроверка — попытка 2.",
      ),
    ).toBeVisible();
  },
};
export const MissingCheck: Story = {
  args: { presentation: detail("30000000-0000-4000-8000-000000000001") },
};
export const FormSubmission: Story = {
  args: {
    presentation: detail("30000000-0000-4000-8000-000000000002"),
    expanded: true,
  },
};
export const ContactUnavailable: Story = {
  args: {
    presentation: detail(firstId, {
      ...reviewedSubmissions,
      submissions: reviewedSubmissions.submissions.map((row) => ({
        ...row,
        person: {
          ...row.person,
          displayName: null,
          telegramUsername: null,
          telegramUrl: null,
          telegramContactState: "unavailable",
        },
      })),
    }),
  },
};
const savedFeedback = {
  comment: "Проверку роли перенеси на сервер.",
  reviewedAt: null,
  updatedAt: "2026-10-05T17:00:00.000Z",
};
const saveSpy = fn((_input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(
    Response.json({ kind: "saved", authorFeedback: savedFeedback }),
  ),
);
export const FeedbackSaves: Story = {
  args: { presentation: detail(), expanded: true },
  decorators: [withMutationFetch(saveSpy)],
  play: async ({ canvasElement }) => {
    saveSpy.mockClear();
    const page = routeContent(canvasElement);
    const save = page.getByRole("button", { name: "Сохранить комментарий" });
    await expect(save).toBeDisabled();
    await userEvent.type(page.getByRole("textbox"), savedFeedback.comment);
    await userEvent.click(save);
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    const body = saveSpy.mock.calls[0]?.[1]?.body;
    if (!(body instanceof FormData))
      throw new Error("Комментарий не отправлен");
    await expect(Object.fromEntries(body)).toEqual({
      submissionId: firstId,
      comment: savedFeedback.comment,
      reviewed: "false",
    });
    await expect(
      await page.findByText(
        "Сохранено. Ученик увидит комментарий на странице задания.",
      ),
    ).toBeVisible();
    await expect(save).toBeDisabled();
  },
};
export const FeedbackSaveFails: Story = {
  args: { presentation: detail(), expanded: true },
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(Response.json({ kind: "unavailable" })),
    ),
  ],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.type(
      page.getByRole("textbox"),
      "Не потеряй этот комментарий",
    );
    await userEvent.click(
      page.getByRole("button", { name: "Сохранить комментарий" }),
    );
    await expect(await page.findByRole("alert")).toHaveTextContent(
      "Не удалось сохранить",
    );
    await expect(page.getByRole("textbox")).toHaveValue(
      "Не потеряй этот комментарий",
    );
  },
};
export const ExpiredSession: Story = {
  args: { presentation: detail(), expanded: true },
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(new Response(null, { status: 401 })),
    ),
  ],
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.type(
      page.getByRole("textbox"),
      "Черновик при истёкшей сессии",
    );
    await userEvent.click(
      page.getByRole("button", { name: "Сохранить комментарий" }),
    );
    await expect(await page.findByRole("alert")).toHaveTextContent(
      "Сессия закончилась",
    );
    await expect(page.getByRole("textbox")).toHaveValue(
      "Черновик при истёкшей сессии",
    );
  },
};
export const NotFound: Story = {
  render: () => <TaskSubmissionsState kind="not_found" />,
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
        ["title", "workspace"].map((part) =>
          originOf(boxOf(canvasElement, `[data-submissions-part='${part}']`)),
        );
      const loading = anchors();
      stagedLoadingOf(loaded).deliverSharedPart();
      await within(canvasElement).findByRole("region", {
        name: "Список сдач",
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
    submissionId: "30000000-0000-4000-8000-000000000003",
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
