import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  learnerMcpUrl,
  notSubmittedYet,
  openProductTask,
  submittedTwice,
} from "@/storybook/product-task.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { TaskSubmissionWorkspace } from "./task-submission-workspace";
import type { OwnSubmissionsView } from "../model/product-task-page";

const returnTo =
  "/materials/practical-lesson?from=%2Fproducts%2Fai-engineering%2Fprogramme&anchor=material%3Afirst";
const environment = publicPageEnvironment(returnTo);
const meta = {
  ...environment,
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-[43rem]">
        <Story />
      </div>
    ),
    ...environment.decorators,
  ],
  component: TaskSubmissionWorkspace,
  title: "Features/Product Task/Submission Workspace",
  args: {
    code: "practice-task",
    version: 2,
    accepting: true,
    history: notSubmittedYet,
    learnerMcpUrl,
    connectionPrompt:
      "Подключи учебный MCP по инструкции https://inside.example/practice-review-setup.txt",
    liveSubmissions: false,
    returnTo,
  },
} satisfies Meta<typeof TaskSubmissionWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FirstReview: Story = {};
export const Guest: Story = { args: { history: { kind: "guest" } } };
export const HistoryUnavailable: Story = {
  args: { history: { kind: "unavailable" } },
};

const criteria = openProductTask.task.definition.criteria;
const reviewHistory = {
  kind: "ready",
  code: "practice-task",
  currentVersion: 2,
  nextCursor: null,
  latestSubmittedAt: null,
  versions: [{ version: 2, criteria }],
  submissions: [],
  reviewProgress: {
    taskVersion: 2,
    runKey: "74000000-0000-4000-8000-000000000001",
    revision: 2,
    phase: "ready",
    summary:
      "Проверка завершена. Основной сценарий работает, но нужно уточнить обработку отказа GitHub.",
    updatedAt: "2026-10-16T14:27:00.000Z",
    reviewReport: {
      summary:
        "Проверил структуру проекта и права доступа. Обсуди замечания со мной перед отправкой.",
      criteria: criteria.map((criterion, index) => ({
        criterionId: criterion.id,
        status: index === 1 ? "violation" : "confirmed",
        evidence: "Проверены файлы проекта и сохранённый отчёт тестов.",
        gap: index === 1 ? "Покажи понятную ошибку при отказе GitHub." : "",
        obtainedByRun: false,
      })),
    },
  },
} satisfies Extract<OwnSubmissionsView, { kind: "ready" }>;

export const AgentMessages: Story = {
  args: { history: reviewHistory },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const log = canvas.getByRole("log", { name: "Сообщения проверки" });
    await expect(within(log).getByText("Агент", { exact: true })).toBeVisible();
    await expect(within(log).getByText(/Проверка завершена\./u)).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Обновить" })).toBeNull();
    await expect(
      canvas.queryByRole("button", { name: "Проверить ещё раз" }),
    ).toBeNull();
    const details = log.querySelector("details");
    await expect(details).not.toHaveAttribute("open");
  },
};
export const AgentMessagesMobile: Story = {
  ...AgentMessages,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const AgentReviewing: Story = {
  args: {
    history: {
      ...reviewHistory,
      reviewProgress: {
        ...reviewHistory.reviewProgress,
        phase: "reviewing",
        summary: "Начинаю проверку. Читаю проект и сверяю права доступа.",
        reviewReport: null,
      },
    },
  },
};
export const AgentStopped: Story = {
  args: {
    history: {
      ...reviewHistory,
      reviewProgress: {
        ...reviewHistory.reviewProgress,
        phase: "stopped",
        summary:
          "Не удалось прочитать отчёт CI. Обсуди со мной, как продолжить проверку.",
        reviewReport: null,
      },
    },
  },
};
export const SavedMessages: Story = { args: { history: submittedTwice } };
export const ReaderHistoryContext: Story = {
  args: {
    history:
      submittedTwice.kind === "ready"
        ? { ...submittedTwice, nextCursor: "cursor-one", continued: true }
        : submittedTwice,
    conflictingAnchorIds: ["task-mine"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const older = canvas.getByRole("link", { name: "Предыдущие сдачи" });
    const newer = canvas.getByRole("link", { name: "К новым сдачам" });
    const href = older.getAttribute("href");
    await expect(href).not.toBeNull();
    const target = new URL(href ?? "", "http://inside.invalid");
    await expect(target.pathname).toBe("/materials/practical-lesson");
    await expect(target.searchParams.get("from")).toBe(
      "/products/ai-engineering/programme",
    );
    await expect(target.searchParams.get("anchor")).toBe("material:first");
    await expect(target.searchParams.get("attemptsAfter")).toBe("cursor-one");
    await expect(target.hash).toBe("#task-mine:page");
    await expect(
      new URL(
        newer.getAttribute("href") ?? "",
        "http://inside.invalid",
      ).searchParams.has("attemptsAfter"),
    ).toBe(false);
  },
};
