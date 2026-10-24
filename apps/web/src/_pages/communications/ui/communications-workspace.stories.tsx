import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import {
  CommunicationsWorkspace,
  type CommunicationsActions,
} from "./communications-workspace.client";

const unavailable = () =>
  Promise.resolve({ kind: "error" as const, code: "unavailable" as const });
const actions = {
  listFunnels: () =>
    Promise.resolve({
      kind: "ready" as const,
      value: {
        funnels: [],
        nextCursor: null,
        botStartUrl: "https://t.me/inside_synthetic_bot",
      },
    }),
  readFunnel: unavailable,
  saveFunnel: unavailable,
  previewFunnel: unavailable,
  publishFunnel: unavailable,
  changeFunnelLifecycle: unavailable,
  readIntro: unavailable,
  saveIntro: unavailable,
  readDeliveries: unavailable,
  skipDelivery: unavailable,
  retryDelivery: unavailable,
  resolveTemplate: unavailable,
  readSavedPosts: unavailable,
  savePost: unavailable,
  samplePost: unavailable,
} satisfies CommunicationsActions;

const meta = {
  title: "Authoring/Communication sequences",
  component: CommunicationsWorkspace,
  args: { actions },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CommunicationsWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CreateSequence: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", {
        name: "Последовательности Telegram",
      }),
    ).toBeVisible();
    await userEvent.click(
      await canvas.findByRole("button", { name: "Создать последовательность" }),
    );
    await expect(
      canvas.getByRole("region", { name: "Редактор последовательности" }),
    ).toBeVisible();
    await expect(
      canvas.getByLabelText("Название последовательности"),
    ).toBeVisible();
    await expect(canvas.queryByText(/Воронк/u)).not.toBeInTheDocument();
  },
};

export const CreateSequenceMobile: Story = {
  ...CreateSequence,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
