import type { Meta, StoryObj } from "@storybook/react-vite";

import { SeriesOrderRouteState } from "@/features/series-order";

const meta = {
  args: { state: { kind: "empty" } },
  component: SeriesOrderRouteState,
  parameters: { nextjs: { appDirectory: true } },
  title: "Pages/Authoring/Состояния серий",
} satisfies Meta<typeof SeriesOrderRouteState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoPlaylists: Story = {};

export const NotFound: Story = {
  args: { state: { kind: "not_found" } },
};

export const LoadError: Story = {
  args: {
    retryHref: "/authoring/playlists/95000000-0000-4000-8000-000000000010",
    state: { kind: "error", reference: "backend-unavailable" },
  },
};
