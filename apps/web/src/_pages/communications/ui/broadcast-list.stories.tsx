import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { BroadcastList } from "./broadcast-list";
import { broadcastFixture } from "./broadcasts.fixtures";
const meta = {
  title: "Pages/Communications/Список рассылок",
  component: BroadcastList,
  args: {
    pending: false,
    hasPrevious: false,
    onSelect: fn(),
    onNext: fn(),
    onFirst: fn(),
    result: {
      kind: "ready",
      nextCursor: "broadcast-page-2",
      broadcasts: (
        [
          "draft",
          "scheduled",
          "running",
          "paused",
          "cancelled",
          "completed",
        ] as const
      ).map((state, i) => ({
        ...broadcastFixture,
        broadcastId: `10000000-0000-4000-8000-00000000000${String(i)}`,
        state,
        scheduledAt: state === "scheduled" ? "2030-10-10T12:00:00Z" : null,
      })),
    },
  },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-6xl p-4">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof BroadcastList>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllStates: Story = {};
export const Loading: Story = { args: { result: undefined } };
export const Empty: Story = {
  args: { result: { kind: "ready", broadcasts: [], nextCursor: null } },
};
export const Denied: Story = {
  args: { result: { kind: "error", code: "forbidden" } },
};
export const Unavailable: Story = {
  args: { result: { kind: "error", code: "provider_unavailable" } },
};
export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const Pagination: Story = {
  args: { hasPrevious: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Черновик/u }));
    await expect(args.onSelect).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000000",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Следующие рассылки" }),
    );
    await expect(args.onNext).toHaveBeenCalledWith("broadcast-page-2");
    await userEvent.click(
      canvas.getByRole("button", { name: "К началу списка" }),
    );
    await expect(args.onFirst).toHaveBeenCalledOnce();
  },
};
