import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ChatTransport, UIMessageChunk } from "ai";
import { expect, userEvent, waitFor, within } from "storybook/test";

import type {
  PracticeReview,
  PracticeReviewUIMessage,
} from "../model/practice-review";
import { PracticeReviewChat } from "./practice-review-chat.client";
import { accountSectionEnvironment } from "@/workshop/story-environment";

const environment = accountSectionEnvironment("/account/course-assistant");
const practiceId = "synthetic:practice-brief";
const contextVersion = "c".repeat(64);
const commit = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const repository = {
  fullName: "learner/agent-course",
  htmlUrl: "https://github.com/learner/agent-course",
};
const criteria = [
  {
    id: "request",
    requirement: "Участник может создать заявку с темой и описанием.",
  },
  {
    id: "status",
    requirement: "Создавший заявку участник может получить её текущий статус.",
  },
  {
    id: "ownership",
    requirement: "Другой участник не получает чужую заявку или её содержимое.",
  },
];
const mainBranch = {
  id: "default_branch",
  kind: "default_branch" as const,
  label: "основная ветка main",
  ref: "main",
  commitSha: commit,
  url: `${repository.htmlUrl}/tree/${commit}`,
};
const pullRequest = {
  id: "pull_request:3",
  kind: "pull_request" as const,
  label: "PR #3 «Бриф консультаций»",
  ref: "feature-3",
  commitSha: "3".repeat(40),
  url: `${repository.htmlUrl}/pull/3`,
};
const queued: PracticeReview = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  practiceId,
  kind: "initial",
  state: "queued",
  contextVersion,
  repository,
  requestedAt: "2026-09-29T09:00:00.000Z",
  completedAt: null,
  candidates: null,
  checked: null,
  result: null,
  previousReviewId: null,
  failure: null,
};
function evidence(path: string, startLine: number, endLine: number) {
  return {
    path,
    startLine,
    endLine,
    url: `${repository.htmlUrl}/blob/${commit}/${path}#L${String(startLine)}-L${String(endLine)}`,
  };
}
const needsWork: PracticeReview = {
  ...queued,
  state: "completed",
  completedAt: "2026-09-29T09:02:00.000Z",
  checked: mainBranch,
  result: {
    practiceStatus: "needs_work",
    summary:
      "Бриф описывает создание заявки и статус, но не говорит, кто видит чужие заявки.",
    criteria: [
      {
        criterionId: "request",
        status: "confirmed",
        evidence: [evidence("docs/brief.md", 1, 4)],
        explanation: "Сценарий создания с темой и описанием описан явно.",
        nextStep: null,
        previousStatus: null,
        changed: false,
      },
      {
        criterionId: "status",
        status: "not_verified",
        evidence: [evidence("docs/brief.md", 6, 7)],
        explanation:
          "Статус упомянут, но не сказано, кто и когда его получает.",
        nextStep: "Опиши сценарий автора заявки после создания.",
        previousStatus: null,
        changed: false,
      },
      {
        criterionId: "ownership",
        status: "violation",
        evidence: [evidence("docs/brief.md", 1, 12)],
        explanation: "Ограничение доступа к чужой заявке в брифе отсутствует.",
        nextStep:
          "Добавь правило: другой участник не получает содержимое заявки.",
        previousStatus: null,
        changed: false,
      },
    ],
  },
};
const accepted: PracticeReview = {
  ...needsWork,
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  kind: "recheck",
  previousReviewId: needsWork.id,
  result: {
    practiceStatus: "accepted",
    summary: "Все требования бизнеса отражены в брифе.",
    criteria: criteria.map(({ id }) => ({
      criterionId: id,
      status: "confirmed" as const,
      evidence: [evidence("docs/brief.md", 1, 14)],
      explanation: "Требование описано явно.",
      nextStep: null,
      previousStatus:
        id === "ownership"
          ? ("violation" as const)
          : id === "status"
            ? ("not_verified" as const)
            : ("confirmed" as const),
      changed: id !== "request",
    })),
  },
};
const awaitingChoice: PracticeReview = {
  ...queued,
  state: "awaiting_choice",
  candidates: [mainBranch, pullRequest],
};

function participant(id: string, text: string): PracticeReviewUIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(
  id: string,
  stage: "choice" | "result",
  review: PracticeReview,
): PracticeReviewUIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "data-practice-review",
        id: `${stage}:${review.id}`,
        data: { stage, review },
      },
    ],
  };
}

/** Сценарный транспорт: отвечает теми же частями потока, что BFF практики. */
function scriptedTransport(
  steps: readonly PracticeReview[],
): ChatTransport<PracticeReviewUIMessage> {
  return {
    sendMessages() {
      const chunks: UIMessageChunk[] = [
        { type: "start", messageId: `story-${String(Date.now())}` },
        ...steps.map((review): UIMessageChunk => ({
          type: "data-practice-review",
          id: `live:${review.id}`,
          data: {
            stage:
              review.state === "awaiting_choice"
                ? "choice"
                : review.state === "completed" || review.state === "failed"
                  ? "result"
                  : "progress",
            review,
          },
        })),
        { type: "finish" },
      ];
      return Promise.resolve(
        new ReadableStream<UIMessageChunk>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
      );
    },
    reconnectToStream: () => Promise.resolve(null),
  };
}

const meta = {
  ...environment,
  title: "Pages/Account/Practice review",
  component: PracticeReviewChat,
  args: {
    practiceId,
    title: "Разобрать обращение бизнеса",
    contextVersion,
    criteria,
    status: "not_started",
    initialMessages: [],
    resume: false,
    transport: scriptedTransport([queued, needsWork]),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Временный семантический чат проверки практики (#788): кнопка проверки, выбор варианта работы и структурированный итог по критериям.",
      },
    },
  },
} satisfies Meta<typeof PracticeReviewChat>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FirstReview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Проверить задание" }),
    );
    await waitFor(() =>
      expect(
        canvas.getByRole("article", { name: "Итог проверки" }),
      ).toBeVisible(),
    );
    await expect(canvas.getByText("Итог: Нужны доработки")).toBeVisible();
    await expect(canvas.getByText("Нарушен")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Проверить снова" }),
    ).toBeEnabled();
  },
};

export const RecheckShowsChanges: Story = {
  args: {
    status: "accepted",
    initialMessages: [
      participant("m1", "Проверить задание"),
      assistant("m2", "result", needsWork),
      participant("m3", "Проверить снова"),
      assistant("m4", "result", accepted),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Итог: Принято · повторная проверка"),
    ).toBeVisible();
    await expect(canvas.getByText(/было: Нарушен/u)).toBeVisible();
  },
};

export const EarlierAssignmentVersion: Story = {
  args: {
    status: "needs_work",
    initialMessages: [
      participant("m1", "Проверить задание"),
      assistant("m2", "result", {
        ...needsWork,
        contextVersion: "b".repeat(64),
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/по прошлой версии задания/u)).toBeVisible();
    await expect(canvas.getByText("ownership")).toBeVisible();
    await expect(
      canvas.queryByText(criteria[2]?.requirement ?? ""),
    ).not.toBeInTheDocument();
  },
};

export const ChooseWork: Story = {
  args: {
    status: "in_review",
    initialMessages: [
      participant("m1", "Проверить задание"),
      assistant("m2", "choice", awaitingChoice),
    ],
    transport: scriptedTransport([
      { ...queued, state: "running" },
      { ...needsWork, checked: pullRequest },
    ]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "PR #3 «Бриф консультаций»" }),
    );
    await waitFor(() =>
      expect(
        canvas.getByRole("article", { name: "Итог проверки" }),
      ).toBeVisible(),
    );
    await expect(
      canvas.getByRole("button", { name: "PR #3 «Бриф консультаций»" }),
    ).toBeDisabled();
  },
};

export const ChangedAssignment: Story = {
  args: {
    initialMessages: [
      participant("m1", "Проверить задание"),
      assistant("m2", "result", {
        ...queued,
        state: "failed",
        completedAt: "2026-09-29T09:01:00.000Z",
        failure: {
          code: "context_version_mismatch",
          currentContextVersion: "e".repeat(64),
        },
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Задание изменилось",
    );
    await expect(
      canvas.getByRole("button", { name: "Проверить по новой версии задания" }),
    ).toBeVisible();
  },
};

export const ReviewInProgress: Story = {
  args: {
    status: "in_review",
    initialMessages: [
      participant("m1", "Проверить задание"),
      {
        id: "progress",
        role: "assistant",
        parts: [
          {
            type: "data-practice-review",
            id: `live:${queued.id}`,
            data: {
              stage: "progress",
              review: { ...queued, state: "running" },
            },
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Проверяю работу…")).toBeVisible();
  },
};

export const RepositoryNotConnected: Story = {
  args: {
    initialMessages: [
      participant("m1", "Проверить задание"),
      {
        id: "refusal",
        role: "assistant",
        parts: [
          {
            type: "data-practice-review-refusal",
            id: "refusal",
            data: {
              code: "repository_link_required",
              currentContextVersion: null,
            },
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: "Открыть раздел помощника" }),
    ).toBeVisible();
  },
};
