import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import type { PurchaseStatus } from "@/entities/subscription";
import { forgetPurchase } from "@/features/billing-checkout";
import { rememberPurchase } from "@/features/billing-checkout/model/checkout";
import type { CommunityEntry } from "@/features/community-entry";
import { getQueryClient } from "@/shared/api/query-client";
import {
  communityEntryResponse,
  confirmedProductPurchase,
  failedPurchase,
} from "@/storybook/billing.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import {
  publicPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { SubscriptionReturnPage } from "./subscription-return-page.client";

/** Путь запроса к собственному BFF, без адреса страницы и параметров. */
function requestPath(input: RequestInfo | URL): string {
  const target =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
  return new URL(target, window.location.origin).pathname;
}

const environment = publicPageEnvironment("/payment/return", {
  account: "authenticated",
});
const botUrl = "https://t.me/inside_storybook_bot";

/**
 * Возврат из банка: страница читает покупку, которую эта вкладка запомнила перед оплатой, и
 * состояние входа в сообщество. Оба ответа BFF ставятся до первого рендера.
 */
function returnFrom(
  purchase: PurchaseStatus,
  entry: CommunityEntry,
): () => () => void {
  return () => {
    environment.beforeEach();
    // Кеш запросов общий на все истории: прежний ответ о покупке и сообществе не переносится.
    getQueryClient().removeQueries({ queryKey: ["account"] });
    rememberPurchase(purchase.purchaseRef);
    const restoreFetch = fetchBeforeRender((input) => {
      const path = requestPath(input);
      return Promise.resolve(
        path === "/api/account/community-entry"
          ? communityEntryResponse(entry)
          : Response.json({ ok: true, value: purchase }),
      );
    })();
    return () => {
      restoreFetch();
      forgetPurchase();
    };
  };
}

const meta = {
  ...environment,
  title: "Pages/Subscription/Return",
  component: SubscriptionReturnPage,
  tags: ["autodocs"],
  beforeEach: returnFrom(confirmedProductPurchase, { kind: "join", botUrl }),
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Возврат после оплаты. Подтверждённая покупка с открытым доступом сразу показывает, как попасть в группу Inside; пока доступ не открыт, перехода нет. Состояния до подтверждения — в «Components/Billing/Purchase return».",
      },
    },
  },
} satisfies Meta<typeof SubscriptionReturnPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConfirmedJoinDesktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("link", { name: "Вступить в сообщество" }),
    ).toHaveAttribute("href", botUrl);
  },
};

export const ConfirmedJoinMobile: Story = {
  ...ConfirmedJoinDesktop,
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};

export const ConfirmedMember: Story = {
  beforeEach: returnFrom(confirmedProductPurchase, { kind: "member" }),
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText(/Вы уже в сообществе Inside/u),
    ).toBeInTheDocument();
    await expect(
      page.queryByRole("link", { name: "Вступить в сообщество" }),
    ).toBeNull();
  },
};

/** Банк отказал: доступ не открыт, поэтому блока сообщества нет. */
export const FailedHidesCommunity: Story = {
  beforeEach: returnFrom(failedPurchase, { kind: "join", botUrl }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Оплата не прошла", { exact: false }),
    ).toBeInTheDocument();
    await expect(canvas.queryByText("Сообщество Inside")).toBeNull();
  },
};
