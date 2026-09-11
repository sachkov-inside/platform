import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  contactFixture,
  funnelFixture,
  statisticsFixture,
} from "./broadcasts.fixtures";
import { AnalyticsPanel, EntryHistory } from "./analytics-panel";


import { broadcastsPageEnvironment } from "@/workshop/broadcasts-story-environment";

const environment = broadcastsPageEnvironment();

const meta = {
  title: "Pages/Communications/Аналитика",
  component: AnalyticsPanel,
  args: {
    funnels: [funnelFixture],
    onContact: fn(),
    onNextContacts: fn(),
    onNextDeliveries: fn(),
    deliveries: { kind: "ready", deliveries: [], nextCursor: null },
    result: statisticsFixture,
  },
  ...environment,
} satisfies Meta<typeof AnalyticsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Summary: Story = {};
export const Unavailable: Story = {
  args: { result: { kind: "error", code: "provider_unavailable" } },
};
export const UnknownBacklog: Story = {
  args: {
    result: { ...meta.args.result, trackingBacklog: { kind: "unavailable" } },
  },
};
export const PersistentSkip: Story = {
  args: {
    deliveries: {
      kind: "ready",
      nextCursor: null,
      deliveries: [
        {
          deliveryId: "10000000-0000-4000-8000-000000000001",
          contactId: "10000000-0000-4000-8000-000000000002",
          cancelRequested: false,
          parts: [
            {
              partId: "10000000-0000-4000-8000-000000000003",
              state: "suppressed",
              diagnosticCode: "marketing_stopped",
            },
          ],
        },
      ],
    },
  },
};

export const Loading: Story = { args: { result: undefined } };
export const Denied: Story = {
  args: { result: { kind: "error", code: "forbidden" } },
};
export const Empty: Story = {
  args: {
    result: {
      ...statisticsFixture,
      statistics: {
        totalBotContacts: 0,
        reachable: 0,
        blocked: 0,
        marketingOff: 0,
        uniqueParticipants: 0,
        deliveries: {
          sent: 0,
          suppressed: 0,
          failed: 0,
          unknown: 0,
          partialCancelled: 0,
          pending: 0,
        },
        trackingHits: 0,
        uniqueTokensWithHits: 0,
        knownAutomationHits: 0,
        analyticsLagSeconds: 0,
        contacts: [],
        nextCursor: null,
      },
      trackingBacklog: { kind: "ready", pending: 0, oldestAgeSeconds: 0 },
    },
  },
};
export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const Dark: Story = { globals: { theme: "dark" } };
export const Paginated: Story = {
  args: {
    deliveries: {
      kind: "ready",
      deliveries: [],
      nextCursor: "delivery-page-2",
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "История входов" }),
    );
    await expect(args.onContact).toHaveBeenCalledWith(contactFixture);
    await userEvent.click(
      canvas.getByRole("button", { name: "Следующие контакты" }),
    );
    await expect(args.onNextContacts).toHaveBeenCalledWith("contacts-page-2");
    await userEvent.click(
      canvas.getByRole("button", { name: "Следующие доставки" }),
    );
    await expect(args.onNextDeliveries).toHaveBeenCalledWith("delivery-page-2");
  },
};
export const EntryTimeline: Story = {
  render: () => (
    <EntryHistory entries={contactFixture.entries} funnels={[funnelFixture]} />
  ),
};
export const EmptyHistory: Story = {
  render: () => <EntryHistory entries={[]} funnels={[]} />,
};
