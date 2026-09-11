import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import { billingOffers, materialsOffer, supportOffer } from "@/workshop/billing.fixtures";

import { BillingAdminView } from "./billing-admin-view.client";
import { authoringPageEnvironment } from "@/workshop/story-environment";

const purchaseRef = "00000000-0000-4000-8000-0000000000b1";
const accountId = "00000000-0000-4000-8000-0000000000c1";

const environment = authoringPageEnvironment("/authoring/billing");

const meta = {
  ...environment,
  title: "Pages/Authoring/Billing admin",
  component: BillingAdminView,
  args: {
    offers: billingOffers,
    payments: [],
    paymentsCursor: null,
    payment: null,
    refunds: null,
    grants: null,
    preview: null,
    batch: null,
    onSaveOffer: fn(),
    onArchiveOffer: fn(),
    onPublishOffer: fn(),
    onUnpublishOffer: fn(),
    onSavePaymentOption: fn(),
    onArchivePaymentOption: fn(),
    onSavePromotion: fn(),
    onArchivePromotion: fn(),
    onListPayments: fn(),
    onReadPayment: fn(),
    onReconcilePayment: fn(),
    onCancelSubscription: fn(),
    onDecideRefund: fn(),
    onExecuteRefund: fn(),
    onReadRefunds: fn(),
    onReadGrants: fn(),
    onExtendGrant: fn(),
    onRevokeGrant: fn(),
    onPreviewBatch: fn(),
    onApplyBatch: fn(),
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Владельческие операции billing: те же API и полномочия, что у admin endpoint и MCP.",
      },
    },
  },
} satisfies Meta<typeof BillingAdminView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Catalog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Действующий каталог" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Сохранить предложение" }),
    ).toBeEnabled();
    // Оба тарифа включены в продажу отдельным обратимым признаком.
    await expect(canvas.getAllByText("В продаже")).toHaveLength(2);
    await expect(
      canvas.getAllByRole("button", { name: "Снять с продажи" }),
    ).toHaveLength(2);
  },
};

export const CatalogNotOnSale: Story = {
  args: {
    offers: billingOffers.map((snapshot) => ({
      ...snapshot,
      offer: { ...snapshot.offer, published: false },
    })),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Не продаётся")).toHaveLength(2);
    await expect(
      canvas.getAllByRole("button", { name: "Вернуть в продажу" }),
    ).toHaveLength(2);
  },
};

/** Один из двух тарифов продаётся: тумблеры независимы. */
export const CatalogOneOnSale: Story = {
  args: {
    offers: [
      materialsOffer,
      { ...supportOffer, offer: { ...supportOffer.offer, published: false } },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("В продаже")).toHaveLength(1);
    await expect(canvas.getAllByText("Не продаётся")).toHaveLength(1);
  },
};

export const Payments: Story = {
  args: {
    payments: [
      {
        purchaseRef,
        accountId,
        kind: "initial",
        state: "confirmed",
        subscriptionRef: null,
        periodIndex: 1,
        amountKopecks: 280_000,
        environment: "demo",
        terminalRef: "demo-terminal",
        paymentId: "8811",
        snapshot: supportOffer,
        fiscalization: "confirmed",
        confirmedAt: "2026-09-01T09:05:00.000Z",
        periodEndsAt: "2026-10-01T09:05:00.000Z",
        createdAt: "2026-09-01T09:00:00.000Z",
        updatedAt: "2026-09-01T09:05:00.000Z",
        access: "ready",
        refundedKopecks: 0,
        refundableKopecks: 280_000,
      },
    ],
    paymentsCursor: purchaseRef,
  },
};

export const GrantPreview: Story = {
  args: {
    preview: {
      outcome: "grantPreview",
      previewRef: "00000000-0000-4000-8000-0000000000d1",
      revision: 1,
      expiresAt: "2026-09-10T11:00:00.000Z",
      rows: [
        { rowKey: "row-1", accountId, status: "confirmed" },
        { rowKey: "row-2", accountId, status: "not_found" },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: "Применить подтверждённые строки" }),
    ).toBeEnabled();
  },
};

export const Failure: Story = {
  args: { error: "Сумма вне подтверждённых границ терминала." },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByRole("button", { name: "Снять с продажи" }),
    ).toHaveLength(2);
  },
};
export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getAllByRole("button", { name: "Снять с продажи" }),
    ).toHaveLength(2);
  },
};
