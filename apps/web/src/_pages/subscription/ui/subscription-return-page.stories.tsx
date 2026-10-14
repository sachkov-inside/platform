import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadonlyURLSearchParams, useSearchParams } from "next/navigation";
import { expect, mocked, waitFor } from "storybook/test";
import { forgetPurchase } from "@/features/billing-checkout";
import { rememberPurchase } from "@/features/billing-checkout/model/checkout";
import { getQueryClient } from "@/shared/api/query-client";
import {
  confirmedProductPurchase,
  failedPurchase,
} from "@/storybook/billing.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import {
  publicPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";
import { SubscriptionReturnPage } from "./subscription-return-page.client";
const environment = publicPageEnvironment("/payment/return", {
  account: "authenticated",
});
const meta = {
  ...environment,
  title: "Pages/Subscription/Return",
  component: SubscriptionReturnPage,
  tags: ["autodocs"],
} satisfies Meta<typeof SubscriptionReturnPage>;
export default meta;
type Story = StoryObj<typeof meta>;
function returned(
  purchase = confirmedProductPurchase,
  referenceInUrl = false,
  preparing = false,
) {
  return () => {
    environment.beforeEach();
    getQueryClient().removeQueries({ queryKey: ["account"] });
    forgetPurchase();
    if (referenceInUrl)
      mocked(useSearchParams).mockReturnValue(
        new ReadonlyURLSearchParams(
          new URLSearchParams({ purchaseRef: purchase.purchaseRef }),
        ),
      );
    else rememberPurchase(purchase.purchaseRef);
    let reads = 0;
    return fetchBeforeRender(() =>
      Promise.resolve(
        Response.json({
          ok: true,
          value:
            preparing && reads++ === 0
              ? { ...purchase, access: "preparing" }
              : purchase,
        }),
      ),
    )();
  };
}
export const ConfirmedDesktop: Story = {
  beforeEach: returned(),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Открыт", { exact: true }),
    ).toBeInTheDocument();
    await expect(page.queryByText("Сообщество Inside")).not.toBeInTheDocument();
  },
};
export const ConfirmedMobile: Story = {
  ...ConfirmedDesktop,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
export const ReferenceWithoutStorage: Story = {
  ...ConfirmedDesktop,
  beforeEach: returned(confirmedProductPurchase, true),
};
export const FulfillmentPollsAfterConfirmation: Story = {
  beforeEach: returned(confirmedProductPurchase, true, true),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Открываем", { exact: true }),
    ).toBeInTheDocument();
    await waitFor(
      () =>
        expect(page.getByText("Открыт", { exact: true })).toBeInTheDocument(),
      { timeout: 7000 },
    );
  },
};
export const Failed: Story = {
  beforeEach: returned(failedPurchase),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Оплата не прошла", { exact: false }),
    ).toBeInTheDocument();
  },
};
