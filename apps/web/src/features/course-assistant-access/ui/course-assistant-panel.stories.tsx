import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { CourseAssistantPanelView } from "./course-assistant-panel-view";
import { accountSectionEnvironment } from "@/workshop/story-environment";

const environment = accountSectionEnvironment("/account/course-assistant");
const repository = {
  id: 101,
  fullName: "learner/agent-course",
  htmlUrl: "https://github.com/learner/agent-course",
};
const second = {
  installationId: 7001,
  repository: {
    id: 102,
    fullName: "learner/second-try",
    htmlUrl: "https://github.com/learner/second-try",
  },
};
const acknowledged = {
  version: "2026-09-28",
  acknowledgedAt: "2026-09-28T10:00:00.000Z",
};
const linked = {
  dataNotice: acknowledged,
  repositoryLink: {
    installationId: 7001,
    repository,
    connectedAt: "2026-09-28T10:05:00.000Z",
    access: "available" as const,
  },
};

const meta = {
  ...environment,
  title: "Pages/Account/Course assistant",
  component: CourseAssistantPanelView,
  args: {
    participant: {
      dataNotice: { version: "2026-09-28", acknowledgedAt: null },
      repositoryLink: null,
    },
    onAcknowledge: fn(),
    onConnect: fn(),
    onShowRepositories: fn(),
    onLink: fn(),
    onDisconnect: fn(),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Временный семантический экран первого использования помощника курса (#787): предупреждение о данных и Repository Link. Визуальный модуль приходит в #798.",
      },
    },
  },
} satisfies Meta<typeof CourseAssistantPanelView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoticeFirst: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("button", { name: "Подключить GitHub" }),
    ).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "Понятно, продолжить" }),
    );
    await expect(args.onAcknowledge).toHaveBeenCalledOnce();
  },
};

export const ReadyToConnect: Story = {
  args: {
    participant: { dataNotice: acknowledged, repositoryLink: null },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Подключить GitHub" }),
    );
    await expect(args.onConnect).toHaveBeenCalledOnce();
  },
};

export const ChooseRepository: Story = {
  args: {
    participant: { dataNotice: acknowledged, repositoryLink: null },
    outcome: "choose_repository",
    repositories: [{ installationId: 7001, repository }, second],
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Выберите репозиторий",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Подключить learner/second-try" }),
    );
    await expect(args.onLink).toHaveBeenCalledWith(second);
  },
};

export const Connected: Story = {
  args: { participant: linked, outcome: "connected" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: "learner/agent-course" }),
    ).toHaveAttribute("href", repository.htmlUrl);
    await expect(canvas.getByText("Доступ на чтение действует.")).toBeVisible();
  },
};

export const ChangingRepository: Story = {
  args: {
    participant: linked,
    repositories: [{ installationId: 7001, repository }, second],
  },
};

export const AccessRevoked: Story = {
  args: {
    participant: {
      ...linked,
      repositoryLink: { ...linked.repositoryLink, access: "revoked" },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Проверка недоступна",
    );
  },
};

export const GitHubDidNotAnswer: Story = {
  args: {
    participant: {
      ...linked,
      repositoryLink: { ...linked.repositoryLink, access: "unknown" },
    },
  },
};

export const WriteAccessRefused: Story = {
  args: {
    participant: { dataNotice: acknowledged, repositoryLink: null },
    outcome: "write_access_requested",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "больше прав, чем чтение",
    );
  },
};

export const Disconnecting: Story = {
  args: { participant: linked, pending: "disconnect" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Отключаем…" }),
    ).toBeDisabled();
  },
};
