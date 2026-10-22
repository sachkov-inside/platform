import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, spyOn, waitFor } from "storybook/test";
import { notSubmittedYet } from "@/storybook/product-task.fixtures";
import { taskSubmissionsQueryKey } from "../model/task-submissions-query";
import { TaskSubmissionHistory } from "./task-submission-history.client";

const accountId = "00000000-0000-4000-8000-000000000001";
const code = "hydration-task";
const initial = { ...notSubmittedYet, code };
const meta = {
  title: "Features/Product Task/Submission History",
  component: TaskSubmissionHistory,
  args: {
    initial,
    code,
    currentVersion: 2,
    returnTo: "/materials/practical-lesson",
    historyAnchor: "task-mine",
    accountId,
    live: false,
  },
} satisfies Meta<typeof TaskSubmissionHistory>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A sibling starts a shared query before this streamed boundary hydrates. */
export const HydratesDuringRefresh: Story = {
  render: () => <div data-hydration-test />,
  play: async ({ canvasElement, args }) => {
    const container = canvasElement.querySelector<HTMLElement>(
      "[data-hydration-test]",
    );
    if (container === null) throw new Error("Missing hydration container");
    const server = new QueryClient();
    const browser = new QueryClient();
    const queryKey = taskSubmissionsQueryKey(accountId, code);
    server.setQueryData(queryKey, initial);
    browser.setQueryData(queryKey, initial);
    const tree = (client: QueryClient) => (
      <QueryClientProvider client={client}>
        <TaskSubmissionHistory {...args} />
      </QueryClientProvider>
    );
    container.innerHTML = renderToString(tree(server));
    await expect(
      container.querySelector("[data-task-history]"),
    ).toHaveAttribute("aria-busy", "false");
    let release: () => void = () => undefined;
    const response = new Promise<typeof initial>((resolve) => {
      release = () => {
        resolve(initial);
      };
    });
    const request = browser.query({ queryKey, queryFn: () => response });
    const errors = spyOn(console, "error").mockImplementation(() => undefined);
    let root: Root | undefined;
    try {
      root = hydrateRoot(container, tree(browser));
      await waitFor(async () => {
        await expect(
          container.querySelector("[data-task-history]"),
        ).toHaveAttribute("aria-busy", "true");
      });
      await expect(errors).not.toHaveBeenCalled();
      release();
      await request;
      await waitFor(async () => {
        await expect(
          container.querySelector("[data-task-history]"),
        ).toHaveAttribute("aria-busy", "false");
      });
    } finally {
      release();
      await request;
      root?.unmount();
      errors.mockRestore();
      server.clear();
      browser.clear();
    }
  },
};
