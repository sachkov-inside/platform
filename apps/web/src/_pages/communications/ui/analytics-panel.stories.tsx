import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { AnalyticsPanel } from "./analytics-panel";
const meta = {
 title: "Pages/Communications/Аналитика", component: AnalyticsPanel,
 args: { funnels: [], onContact: fn(), onNextContacts: fn(), onNextDeliveries: fn(), deliveries: { kind: "ready", deliveries: [], nextCursor: null }, result: { kind: "ready", trackingBacklog: { kind: "ready", pending: 3, oldestAgeSeconds: 120 }, statistics: { totalBotContacts: 140, reachable: 130, blocked: 10, marketingOff: 20, uniqueParticipants: 110, deliveries: { sent: 80, suppressed: 5, failed: 1, unknown: 2, partialCancelled: 1, pending: 32 }, trackingHits: 34, uniqueTokensWithHits: 21, knownAutomationHits: 5, analyticsLagSeconds: 30, contacts: [], nextCursor: null } } },
 decorators: [Story => <main className="mx-auto max-w-4xl p-4"><h1 className="text-2xl">Коммуникации</h1><h2 className="text-xl">Аналитика</h2><Story /></main>],
} satisfies Meta<typeof AnalyticsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Summary: Story = {};
export const Unavailable: Story = { args: { result: { kind: "error", code: "provider_unavailable" } } };
export const UnknownBacklog: Story = { args: { result: { ...meta.args.result, trackingBacklog: { kind: "unavailable" } } } };
export const PersistentSkip: Story = { args: { deliveries: { kind: "ready", nextCursor: null, deliveries: [{ deliveryId: "10000000-0000-4000-8000-000000000001", contactId: "10000000-0000-4000-8000-000000000002", cancelRequested: false, parts: [{ partId: "10000000-0000-4000-8000-000000000003", state: "suppressed", diagnosticCode: "marketing_stopped" }] }] } } };
