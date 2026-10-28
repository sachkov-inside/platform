import type { Meta, StoryObj } from "@storybook/react-vite";
import { Suspense, use, useEffect, useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import {
  TaskSubmissionsLoading,
  TaskSubmissionsRuntime,
  TaskSubmissionsState,
  TaskSubmissionsView,
} from "@/_pages/task-submissions";
import { useTaskSubmissionsRuntime } from "./task-submissions-runtime.client";
import { presentTaskSubmissions } from "../model/task-submissions-presentation";
import type { TaskSubmissions } from "../model/task-submissions";
import { withMutationFetch } from "@/storybook/mutation-mock";
import { Button } from "@/shared/ui/button";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";
import {
  awaitingSubmissions,
  manySubmissions,
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

import { getStoryRouter } from "../../../../.storybook/mocks/next-navigation";

const environment = authoringPageEnvironment("/authoring/submissions");
/** The default view: new submissions only, as the route asks the backend (#1717). */
const presentation = presentTaskSubmissions({
  submissions: awaitingSubmissions,
  selection: {},
  continued: false,
});
const allPresentation = presentTaskSubmissions({
  submissions: reviewedSubmissions,
  selection: {},
  feedback: "all",
  continued: false,
});
const routerPush = fn();
/** Filter choices are addresses: the story records where the page would go. */
function captureRouterPush() {
  environment.beforeEach();
  routerPush.mockClear();
  const router = getStoryRouter();
  const original = router.push;
  router.push = routerPush;
  return () => {
    router.push = original;
  };
}
const rowsName = "Сдачи, новые сверху";
function rowLinks(canvasElement: HTMLElement, width: "desktop" | "mobile") {
  const page = routeContent(canvasElement);
  return within(
    width === "desktop"
      ? page.getByRole("table", { name: rowsName })
      : page.getByRole("list", { name: rowsName }),
  ).getAllByRole("link");
}
/** Radix Select hides the page and blocks the pointer until it has closed. */
async function selectClosed() {
  await waitFor(() => {
    if (
      document.body.style.pointerEvents === "none" ||
      document.querySelector("[data-aria-hidden='true']") !== null
    )
      throw new Error("Выбор ещё закрывается");
  });
}
async function expectNoHorizontalOverflow() {
  await waitFor(() =>
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    ),
  );
}
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
  globals: desktop.globals,
  beforeEach: captureRouterPush,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Сдачи" }),
    ).toBeVisible();
    const table = page.getByRole("table", { name: rowsName });
    await expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Человек",
      "Продукт и задание",
      "Версия требований",
      "Время",
      "Состояние",
    ]);
    await expect(rowLinks(canvasElement, "desktop")).toHaveLength(2);
    await expect(within(table).getAllByText("Новая")).toHaveLength(2);
    await expect(
      within(table).getByText("Нужны исправления, попытка 2"),
    ).toBeVisible();
    await expect(within(table).getByText("Сейчас 2")).toBeVisible();
    await expect(within(table).getByText("5 окт. 2026, 19:40")).toBeVisible();
    await expect(page.queryByText("Марк Белов")).not.toBeInTheDocument();
    await expect(page.queryByRole("article")).not.toBeInTheDocument();
    await expect(
      within(page.getByRole("list", { name: "Применённые фильтры" })).getByText(
        "Без комментария",
      ),
    ).toBeVisible();
    await expect(
      page.queryByRole("button", { name: "Сбросить" }),
    ).not.toBeInTheDocument();
    await expect(page.queryByRole("searchbox")).not.toBeInTheDocument();
    await userEvent.click(
      page.getByRole("combobox", { name: "Комментарий автора" }),
    );
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Все сдачи" }),
    );
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith(
        "/authoring/submissions?feedback=all",
      ),
    );
    await selectClosed();
    await expectNoHorizontalOverflow();
  },
};
export const SubmissionsMobile: Story = {
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.queryByRole("table", { name: rowsName }),
    ).not.toBeInTheDocument();
    const links = rowLinks(canvasElement, "mobile");
    await expect(links).toHaveLength(2);
    await expect(links[0]).toHaveAttribute(
      "href",
      "/authoring/submissions?submission=30000000-0000-4000-8000-000000000003",
    );
    await expect(
      within(page.getByRole("list", { name: rowsName })).getAllByText("Новая"),
    ).toHaveLength(2);
    await expectNoHorizontalOverflow();
  },
};
export const AllSubmissions: Story = {
  globals: desktop.globals,
  beforeEach: captureRouterPush,
  args: { presentation: allPresentation },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(rowLinks(canvasElement, "desktop")).toHaveLength(3);
    const table = within(page.getByRole("table", { name: rowsName }));
    await expect(table.getByText("Прокомментирована")).toBeVisible();
    await expect(table.getByText("Без самопроверки")).toBeVisible();
    await expect(
      page.queryByRole("list", { name: "Применённые фильтры" }),
    ).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Сбросить" }));
    await expect(routerPush).toHaveBeenCalledWith("/authoring/submissions");
  },
};
export const AllSubmissionsMobile: Story = {
  ...AllSubmissions,
  globals: mobile.globals,
  play: async ({ canvasElement }) => {
    await expect(rowLinks(canvasElement, "mobile")).toHaveLength(3);
    await expectNoHorizontalOverflow();
  },
};
const single = presentTaskSubmissions({
  submissions: {
    ...reviewedSubmissions,
    submissions: reviewedSubmissions.submissions.slice(0, 1),
  },
  selection: {},
  continued: false,
});
export const SingleSubmission: Story = {
  globals: desktop.globals,
  args: { presentation: single },
  play: async ({ canvasElement }) => {
    await expect(rowLinks(canvasElement, "desktop")).toHaveLength(1);
    await expect(
      routeContent(canvasElement).getByText("На странице: 1 сдача"),
    ).toBeInTheDocument();
  },
};
export const SingleSubmissionMobile: Story = {
  globals: mobile.globals,
  args: { presentation: single },
  play: async ({ canvasElement }) => {
    await expect(rowLinks(canvasElement, "mobile")).toHaveLength(1);
    await expectNoHorizontalOverflow();
  },
};
const long = presentTaskSubmissions({
  submissions: manySubmissions(20),
  selection: {},
  feedback: "all",
  continued: false,
});
export const LongList: Story = {
  globals: desktop.globals,
  args: { presentation: long },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(rowLinks(canvasElement, "desktop")).toHaveLength(20);
    await expect(
      page.getAllByText("Екатерина Александровна Иванова-Петрова", {
        selector: "a",
      }).length,
    ).toBeGreaterThan(0);
    await expect(
      page.getByRole("link", { name: "Более ранние" }),
    ).toHaveAttribute(
      "href",
      "/authoring/submissions?feedback=all&cursor=page-2",
    );
    await expectNoHorizontalOverflow();
  },
};
export const LongListMobile: Story = {
  globals: mobile.globals,
  args: { presentation: long },
  play: async ({ canvasElement }) => {
    await expect(rowLinks(canvasElement, "mobile")).toHaveLength(20);
    await expect(
      routeContent(canvasElement).getAllByText("@konstantin_vasilevsky_dev", {
        selector: "a",
      }).length,
    ).toBeGreaterThan(0);
    await expectNoHorizontalOverflow();
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
export const SubmissionMobile: Story = {
  globals: mobile.globals,
  args: { presentation: detail() },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Онбординг команды" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Все сдачи" })).toBeVisible();
    await expectNoHorizontalOverflow();
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
    if (typeof body !== "string") throw new Error("Комментарий не отправлен");
    await expect(JSON.parse(body)).toEqual({
      submissionId: firstId,
      comment: savedFeedback.comment,
      reviewed: false,
    });
    await expect(
      await page.findByText(
        "Сохранено. Ученик увидит комментарий на странице задания.",
      ),
    ).toBeVisible();
    await expect(save).toBeDisabled();
  },
};
export const FeedbackSavesMobile: Story = {
  ...FeedbackSaves,
  globals: mobile.globals,
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
  globals: desktop.globals,
  beforeEach: captureRouterPush,
  args: {
    presentation: presentTaskSubmissions({
      continued: false,
      selection: {
        productId: submissionsProductId,
        chapterId: submissionsSecondChapter,
      },
      feedback: "all",
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
    await expect(
      page.getByRole("combobox", { name: "Глава или задание" }),
    ).toHaveTextContent("Глава 2. Заявки: все задания");
    await expect(
      page.getByRole("combobox", { name: "Продукт" }),
    ).toHaveTextContent("AI Engineering");
    const chips = within(
      page.getByRole("list", { name: "Применённые фильтры" }),
    );
    await expect(chips.getByText("AI Engineering")).toBeVisible();
    await expect(chips.getByText("Глава 2. Заявки")).toBeVisible();
    await userEvent.click(
      page.getByRole("combobox", { name: "Глава или задание" }),
    );
    await expect(
      (await within(document.body).findAllByRole("option")).map(
        (option) => option.textContent,
      ),
    ).toEqual([
      "Все задания",
      "Глава 1. Онбординг: все задания",
      "Онбординг команды",
      "Глава 2. Заявки: все задания",
      "Заявки клиентов",
    ]);
    await userEvent.click(
      within(document.body).getByRole("option", { name: "Заявки клиентов" }),
    );
    await waitFor(() =>
      expect(routerPush).toHaveBeenLastCalledWith(
        `/authoring/submissions?productId=${submissionsProductId}&task=aie-ch2-requests&feedback=all`,
      ),
    );
    await selectClosed();
    await userEvent.click(
      page.getByRole("button", { name: "Убрать фильтр «AI Engineering»" }),
    );
    await expect(routerPush).toHaveBeenLastCalledWith(
      "/authoring/submissions?feedback=all",
    );
  },
};

export const Paged: Story = {
  globals: desktop.globals,
  args: {
    presentation: presentTaskSubmissions({
      continued: true,
      cursor: "page-2",
      selection: {},
      submissions: { ...awaitingSubmissions, nextCursor: "next-page" },
    }),
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const pages = within(
      page.getByRole("navigation", { name: "Страницы сдач" }),
    );
    await expect(
      pages.getByRole("link", { name: "Более ранние" }),
    ).toHaveAttribute("href", "/authoring/submissions?cursor=next-page");
    await expect(pages.getByRole("link", { name: "К новым" })).toHaveAttribute(
      "href",
      "/authoring/submissions",
    );
    await expect(rowLinks(canvasElement, "desktop")[0]).toHaveAttribute(
      "href",
      "/authoring/submissions?cursor=page-2&submission=30000000-0000-4000-8000-000000000003",
    );
  },
};

const nothingAwaiting = { ...presentation, rows: [] };
export const NothingAwaiting: Story = {
  globals: desktop.globals,
  args: { presentation: nothingAwaiting },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Все сдачи прокомментированы" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Показать все сдачи" }),
    ).toHaveAttribute("href", "/authoring/submissions?feedback=all");
    await expect(
      page.queryByRole("table", { name: rowsName }),
    ).not.toBeInTheDocument();
  },
};
export const NothingAwaitingMobile: Story = {
  ...NothingAwaiting,
  globals: mobile.globals,
};
export const Empty: Story = {
  globals: desktop.globals,
  args: { presentation: { ...allPresentation, rows: [] } },
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("heading", {
        name: "Сдач пока нет",
      }),
    ).toBeVisible();
  },
};
export const EmptyMobile: Story = { ...Empty, globals: mobile.globals };
export const NoResults: Story = {
  globals: desktop.globals,
  beforeEach: captureRouterPush,
  args: {
    presentation: {
      ...presentation,
      selection: { productId: submissionsProductId },
      rows: [],
    },
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByText("По этому фильтру нет сдач без комментария."),
    ).toBeVisible();
    await userEvent.click(
      page.getByRole("button", { name: "Сбросить фильтры" }),
    );
    await expect(routerPush).toHaveBeenCalledWith("/authoring/submissions");
  },
};
export const NoResultsMobile: Story = { ...NoResults, globals: mobile.globals };
export const EmptyPageWithContinuation: Story = {
  globals: desktop.globals,
  args: {
    presentation: presentTaskSubmissions({
      continued: false,
      selection: {},
      submissions: {
        ...awaitingSubmissions,
        submissions: [],
        nextCursor: "page-2",
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "На этой странице сдач нет" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Более ранние" }),
    ).toHaveAttribute("href", "/authoring/submissions?cursor=page-2");
  },
};
export const Loading: Story = {
  globals: desktop.globals,
  render: () => <TaskSubmissionsLoading />,
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("region", {
        name: "Загружаем сдачи",
      }),
    ).toBeVisible();
  },
};
export const LoadingMobile: Story = { ...Loading, globals: mobile.globals };
export const Forbidden: Story = {
  render: () => <TaskSubmissionsState kind="forbidden" />,
};
export const Unauthorized: Story = {
  render: () => <TaskSubmissionsState kind="unauthorized" />,
};
export const Unavailable: Story = {
  globals: desktop.globals,
  render: () => <TaskSubmissionsState kind="unavailable" />,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("alert")).toHaveTextContent(
      "Сдачи не загрузились",
    );
    await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  },
};
export const UnavailableMobile: Story = {
  ...Unavailable,
  globals: mobile.globals,
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
        page.getByRole("region", { name: "Загружаем сдачи" }),
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

const acceptedDraftCommits = fn();

function FeedbackCommitProbe() {
  const { drafts } = useTaskSubmissionsRuntime();
  useEffect(() => {
    acceptedDraftCommits(drafts);
  }, [drafts]);
  return null;
}

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
      <FeedbackCommitProbe />
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
  beforeEach: () => {
    environment.beforeEach();
    acceptedDraftCommits.mockClear();
  },
  render: () => <FeedbackSnapshots />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const comment = canvas.getByRole("textbox", {
      name: /Комментарий для ученика/u,
    });
    await expect(comment).toHaveValue("Серверный отзыв 1");
    await waitFor(() => expect(acceptedDraftCommits).toHaveBeenCalledTimes(2));
    await userEvent.click(
      canvas.getByRole("button", { name: "Свежий серверный ответ" }),
    );
    await expect(comment).toHaveValue("Серверный отзыв 3");
    await waitFor(() => expect(acceptedDraftCommits).toHaveBeenCalledTimes(3));
    await userEvent.click(
      canvas.getByRole("button", { name: "Запоздалый серверный ответ" }),
    );
    await expect(comment).toHaveValue("Серверный отзыв 3");
    await expect(acceptedDraftCommits).toHaveBeenCalledTimes(3);
    console.info("EC-2 committed draft snapshots: initial=2, newer=3, stale=3");
  },
};

export const PagedProductChoices: Story = {
  args: {
    presentation: presentTaskSubmissions({
      continued: false,
      cursor: "same-submissions",
      productCursor: "current-products",
      selection: {},
      submissions: {
        ...reviewedSubmissions,
        nextProductCursor: "next-products",
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("link", { name: "Другие продукты" }),
    ).toHaveAttribute(
      "href",
      "/authoring/submissions?cursor=same-submissions&productCursor=next-products",
    );
    await expect(
      page.getByRole("link", { name: "Первые продукты" }),
    ).toHaveAttribute("href", "/authoring/submissions?cursor=same-submissions");
  },
};
