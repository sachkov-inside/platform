import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { withMutationFetch } from "@/storybook/mutation-mock";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";
import {
  reviewedSubmissions,
  submissionsGuideId,
  submissionsSecondChapter,
} from "@/storybook/task-submissions.fixtures";

import { TaskSubmissionsState } from "./task-submissions-states";
import { TaskSubmissionsView } from "./task-submissions-view";

const environment = authoringPageEnvironment("/authoring/submissions");

const meta = {
  ...environment,
  title: "Pages/Authoring/Task submissions",
  component: TaskSubmissionsView,
  args: {
    continued: false,
    selection: {},
    submissions: reviewedSubmissions,
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Раздел «Сдачи» автора (#948): сдачи заданий новыми сверху, фильтр по продукту, главе и заданию, отчёт агента ученика как текст и отзыв автора — комментарий и «посмотрел автор». Временный семантический вид до #967.",
      },
    },
  },
} satisfies Meta<typeof TaskSubmissionsView>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Три сдачи двух глав: отчёт агента, сдача формой с отзывом автора и сдача по прежней версии. */
export const Submissions: Story = {
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Сдачи" }),
    ).toBeInTheDocument();
    const list = page.getByRole("list", { name: "Сдачи, новые сверху" });
    const cards = within(list).getAllByRole("listitem", {
      name: /Онбординг команды|Заявки клиентов/u,
    });
    await expect(cards).toHaveLength(3);
    const newest = within(cards[0] ?? list);
    await expect(newest.getByText("Через агента")).toBeInTheDocument();
    await expect(
      newest.getByText("10000000-0000-4000-8000-000000000001"),
    ).toBeInTheDocument();
    await expect(newest.getByText("telegram:synthetic-01")).toBeInTheDocument();
    await expect(
      newest.getByRole("link", {
        name: "https://github.com/learner/devportal",
      }),
    ).toHaveAttribute("rel", "noopener noreferrer nofollow");
    await expect(
      newest.getByText(/commit 4f2a9c1, есть незакоммиченные изменения/u),
    ).toBeInTheDocument();
    const oldest = within(cards[2] ?? list);
    await expect(
      oldest.getByText("Версия требований 1 (сейчас 2)"),
    ).toBeInTheDocument();
    await expect(oldest.getByText("Без заметки")).toBeInTheDocument();
    const form = within(cards[1] ?? list);
    await expect(form.getByText("Через форму")).toBeInTheDocument();
    await expect(form.getByText("Telegram не привязан")).toBeInTheDocument();
    await expect(
      form.getByRole("checkbox", { name: "Посмотрел автор" }),
    ).toBeChecked();
    await expect(
      form.getByRole("textbox", { name: /Комментарий для ученика/u }),
    ).toHaveValue("Хорошо: повтор проверен. Добавь владельца заявки.");
  },
};

/** Отчёт агента — недоверенный текст: разметка из отчёта видна как текст и не исполняется. */
export const ReportIsText: Story = {
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    const card = within(
      page.getAllByRole("listitem", { name: "Онбординг команды" })[0] ??
        canvasElement,
    );
    await userEvent.click(card.getByText("Отчёт агента ученика"));
    await expect(
      card.getByText("Это отчёт агента ученика, не проверка Platform."),
    ).toBeVisible();
    await expect(
      card.getByText(/<img src=x onerror="alert\(1\)"> Роль читается/u),
    ).toBeVisible();
    await expect(canvasElement.querySelector("img[src='x']")).toBeNull();
    await expect(card.getByText("Нарушение")).toBeVisible();
    await expect(
      card.getByText("Обязательно · получено запуском"),
    ).toBeVisible();
    await userEvent.click(card.getByText("Критерии версии 2"));
    // The report names the criterion by its requirement; the version list shows it again.
    const listed = card.getAllByText("Второй агент проверяет выдачу.");
    await expect(listed).toHaveLength(2);
    await expect(listed[1]).toBeVisible();
  },
};

const saveSpy = fn((input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(
    (input instanceof Request ? input.url : input.toString()).endsWith(
      "/api/authoring/guide-tasks/feedback",
    )
      ? Response.json({
          kind: "saved",
          authorFeedback: {
            comment: "Проверку роли перенеси на сервер.",
            reviewedAt: "2026-10-05T17:00:00.000Z",
            updatedAt: "2026-10-05T17:00:00.000Z",
          },
        })
      : new Response(null, { status: 404 }),
  ),
);

/** Автор отмечает сдачу и пишет комментарий; сохранённый ответ заменяет состояние формы. */
export const FeedbackSaves: Story = {
  decorators: [withMutationFetch(saveSpy)],
  play: async ({ canvasElement }) => {
    saveSpy.mockClear();
    const page = routeContent(canvasElement);
    const card = within(
      page.getAllByRole("listitem", { name: "Онбординг команды" })[0] ??
        canvasElement,
    );
    const save = card.getByRole("button", { name: "Сохранить отзыв" });
    await expect(save).toBeDisabled();
    await userEvent.click(
      card.getByRole("checkbox", { name: "Посмотрел автор" }),
    );
    await userEvent.type(
      card.getByRole("textbox", { name: /Комментарий для ученика/u }),
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
      await card.findByText(
        "Сохранено. Ученик увидит отзыв на странице задания.",
      ),
    ).toBeVisible();
  },
};

/** Фильтр по главе: выбраны продукт и глава, задания в списке — только этой главы. */
export const FilteredByChapter: Story = {
  args: {
    selection: {
      guideId: submissionsGuideId,
      chapterId: submissionsSecondChapter,
    },
    submissions: {
      ...reviewedSubmissions,
      submissions: reviewedSubmissions.submissions.filter(
        (item) => item.task.chapterId === submissionsSecondChapter,
      ),
    },
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
    await expect(
      page.getAllByRole("listitem", { name: /Заявки клиентов/u }),
    ).toHaveLength(1);
  },
};

/** Следующая страница: путь к более ранним сдачам и обратно к новым. */
export const Paged: Story = {
  args: {
    continued: true,
    submissions: { ...reviewedSubmissions, nextCursor: "next-page" },
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
  args: { submissions: { ...reviewedSubmissions, submissions: [] } },
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByText(/Сдач пока нет/u),
    ).toBeInTheDocument();
  },
};

export const EmptyFilter: Story = {
  args: {
    selection: { guideId: submissionsGuideId },
    submissions: { ...reviewedSubmissions, submissions: [] },
  },
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByText("По этому фильтру сдач нет."),
    ).toBeInTheDocument();
  },
};

export const Forbidden: Story = {
  render: () => <TaskSubmissionsState kind="forbidden" />,
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByText("Нет доступа к сдачам"),
    ).toBeInTheDocument();
  },
};

export const Unauthorized: Story = {
  render: () => <TaskSubmissionsState kind="unauthorized" />,
};

export const Unavailable: Story = {
  render: () => <TaskSubmissionsState kind="unavailable" />,
};
