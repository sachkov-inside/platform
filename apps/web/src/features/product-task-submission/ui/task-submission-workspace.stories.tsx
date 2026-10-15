import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  learnerMcpUrl,
  notSubmittedYet,
  submittedTwice,
} from "@/storybook/product-task.fixtures";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { TaskSubmissionWorkspace } from "./task-submission-workspace";

const returnTo =
  "/materials/practical-lesson?from=%2Fproducts%2Fai-engineering%2Fprogramme&anchor=material%3Afirst";
const meta = {
  ...publicPageEnvironment(returnTo),
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
