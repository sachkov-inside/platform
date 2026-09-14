import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { authoringPageEnvironment } from "@/workshop/story-environment";
import { TributeOperationsView } from "./tribute-operations-view.client";
const tier = { id: "62500000-0000-4000-8000-000000000001", revision: 1, name: "Материалы и сообщество", benefits: ["materials" as const, "community" as const], contentScope: { guideIds: [], materialIds: [] } };
const environment = authoringPageEnvironment("/authoring/billing");
const meta = {
  ...environment, title: "Pages/Authoring/Tribute import", component: TributeOperationsView,
  args: { data: { page: 0, hasMore: false, imports: [], policies: [], unconfirmedSources: [], sources: [], inbox: [], metrics: { unresolvedImports: 0, pendingIdentity: 0, unresolvedEvents: 0, temporarySources: 0, staleConfirmations: 0, rolloutBlocked: false } },
    tiers: [tier], preview: null, loading: false, busy: false, error: null, message: "",
    onMessage: fn(), onRefresh: fn(), onPage: fn(), onPolicy: fn(), onPreview: fn(), onApply: fn(), onRecover: fn(), onReconcile: fn(), onInbox: fn(), onDismiss: fn() },
} satisfies Meta<typeof TributeOperationsView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("heading", { name: "Перенос доступа из Tribute" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Проверить без применения" })).toBeEnabled();
} };
export const MixedPreview: Story = { args: { preview: { previewRef: "62500000-0000-4000-8000-000000000002", batchRef: "Сверка подтверждённого периода", expiresAt: "2030-01-01T00:10:00.000Z", rows: [
  { rowRef: "Проверенный период", status: "matched", detail: "Подтверждённый срок", sourceId: null, accountId: null, sourceRevision: 1, policyRevision: 1, enrollmentRevision: 1, bindingFingerprint: null, shortens: true, tier, startsAt: "2030-01-01T00:00:00.000Z", endsAt: "2030-02-01T00:00:00.000Z" },
  { rowRef: "Нужна проверка", status: "unknown_term", detail: "Нет подтверждённой даты окончания", sourceId: null, accountId: null, sourceRevision: 0, policyRevision: 1, enrollmentRevision: 0, bindingFingerprint: null, shortens: false, tier, startsAt: null, endsAt: null },
] } }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await expect(canvas.getByText("Выбранная строка сократит ранее подтверждённый срок.")).toBeVisible(); await expect(canvas.getByRole("checkbox", { name: /Нужна проверка/u })).toBeDisabled(); } };
export const Loading: Story = { args: { data: null, loading: true } };
export const Unavailable: Story = { args: { data: null, error: "Источник временно недоступен. Права не изменены." } };
export const PendingReview: Story = { args: { data: { ...meta.args.data, imports: [{ previewRef: "62500000-0000-4000-8000-000000000003", batchRef: "Сверка с неизвестными сроками", pendingRows: ["строка-7", "строка-12"], revision: 1, state: "pending", expiresAt: "2030-01-01T00:10:00.000Z", reason: "Ожидает подтверждения" }], metrics: { ...meta.args.data.metrics, unresolvedImports: 1, pendingIdentity: 2, rolloutBlocked: true } } } };
