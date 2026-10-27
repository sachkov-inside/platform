import type { Meta, StoryObj } from "@storybook/react-vite";
import { productOnlyOffer } from "@/storybook/billing.fixtures";
import { authoringPageEnvironment } from "@/storybook/story-environment";
import { billingBeforeRender, billingOk } from "./billing-bff.fixtures";
import { BillingAdminLoading } from "./billing-admin-frame";
import { BillingAdminPanel } from "./billing-admin-panel.client";
const environment = authoringPageEnvironment("/authoring/billing");
const meta = {
  ...environment,
  title: "Pages/Authoring/Billing",
  component: BillingAdminPanel,
  args: { offers: [productOnlyOffer], cohorts: [] },
  beforeEach: [
    environment.beforeEach,
    billingBeforeRender({
      "content/list": billingOk({ outcome: "content", items: [] }),
      "payment-links/list": billingOk({
        outcome: "paymentLinks",
        items: [],
        nextCursor: null,
      }),
      "activation-rules/list": billingOk({
        outcome: "activationRules",
        items: [],
      }),
      "respondents/status": billingOk({
        outcome: "respondentStatus",
        imported: 0,
        issued: 0,
      }),
    }),
  ],
} satisfies Meta<typeof BillingAdminPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ProductPrices: Story = {};
export const Empty: Story = { args: { offers: [] } };

export const Loading: Story = { render: () => <BillingAdminLoading /> };
