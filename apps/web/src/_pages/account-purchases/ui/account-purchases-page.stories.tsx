import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within, userEvent } from "storybook/test";

import {
  buyerGrounds,
  buyerPayments,
} from "@/storybook/buyer-journey.fixtures";
import { billingErrorMessage } from "@/entities/subscription";
import {
  pendingResponse,
  respondByPath,
  type RouteResponse,
  subscribedMemberRoutes,
  unauthorizedResponse,
} from "@/storybook/account.fixtures";
import {
  billingContactResponse,
  billingFailureResponse,
  communityEntryResponse,
  currentBillingResponse,
} from "@/storybook/billing.fixtures";
import {
  accountSectionEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { AccountPurchasesPage } from "./account-purchases-page.client";

const path = "/account/purchases";
const botUrl = "https://t.me/inside_storybook_bot";

const desktop = {
  viewport: { isRotated: false, value: "desktop1440" },
} as const;
const mobile = { viewport: { isRotated: false, value: "mobile390" } } as const;

/** Ответы разделов «Покупки» у участника с подпиской: вход в сообщество и подтверждённый email. */
const purchasesRoutes: Readonly<Record<string, RouteResponse>> = {
  ...subscribedMemberRoutes,
  "/api/account/community-entry": () =>
    communityEntryResponse({ kind: "join", botUrl }),
  "/api/account/billing/contact": () => billingContactResponse(),
};

/** Раздел в кабинете; `routes` заменяет ответы участника с подпиской там, где story их меняет. */
function purchasesPage(
  routes: Readonly<Record<string, RouteResponse>> = {},
  options: Parameters<typeof accountSectionEnvironment>[1] = {},
): Pick<Story, "beforeEach" | "decorators" | "parameters"> {
  return accountSectionEnvironment(path, {
    ...options,
    fetch: () => respondByPath({ ...purchasesRoutes, ...routes }),
  });
}

/** Покупатель без подписки и без оснований доступа. */
const withoutGrounds = {
  "/api/account/billing": () => currentBillingResponse(null),
  "/api/account/community-entry": () =>
    communityEntryResponse({ kind: "none" }),
};

const meta = {
  title: "Pages/Account/Purchases",
  component: AccountPurchasesPage,
  parameters: {
    docs: {
      description: {
        component:
          "Раздел «Покупки» маршрута `/account/purchases`: что доступно и по какому основанию, вход в сообщество, email для чеков, способ оплаты и история списаний. Условия подписки и управление ею живут в разделе «Подписка».",
      },
    },
  },
} satisfies Meta<typeof AccountPurchasesPage>;
export default meta;
type Story = StoryObj<typeof meta>;

async function expectSubscribedPurchases(canvasElement: HTMLElement) {
  const page = routeContent(canvasElement);
  await expect(
    page.getByRole("heading", { level: 1, name: "Покупки" }),
  ).toBeInTheDocument();
  await expect(
    await page.findByRole("heading", { name: "Что вам доступно" }),
  ).toBeInTheDocument();
  await expect(
    page.queryByRole("heading", { name: "Email для чеков и сообщений" }),
  ).not.toBeInTheDocument();
  await expect(
    page.queryByRole("link", { name: "Вступить в сообщество" }),
  ).not.toBeInTheDocument();
  await userEvent.click(page.getByText("История оплат, чеки и возвраты"));
  await expect(page.getByText(/Оплата не прошла/u)).toBeInTheDocument();
}

/** Участник с подпиской: все блоки раздела на своих местах. */
export const SubscribedDesktop: Story = {
  ...purchasesPage(),
  globals: desktop,
  play: async ({ canvasElement }) => {
    await expectSubscribedPurchases(canvasElement);
    // Подписка куплена, поэтому кабинет показывает и её раздел.
    const sections = within(canvasElement).getAllByRole("navigation", {
      name: "Разделы кабинета",
    });
    await expect(
      within(sections.at(-1) ?? canvasElement).getByRole("link", {
        name: "Подписка",
      }),
    ).toBeInTheDocument();
  },
};

export const SubscribedMobile: Story = {
  ...purchasesPage(),
  globals: mobile,
  play: async ({ canvasElement }) => {
    await expectSubscribedPurchases(canvasElement);
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  },
};

/** Оснований нет, подписку продают: раздел зовёт на витрину. */
export const NoGrounds: Story = {
  ...purchasesPage(withoutGrounds),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Действующих оснований доступа нет."),
    ).toBeInTheDocument();
    await expect(
      page.getByRole("link", { name: "Посмотреть тарифы" }),
    ).toHaveAttribute("href", "/payment/checkout");
    await expect(
      page.queryByText("Карта сохраняется при оформлении подписки."),
    ).not.toBeInTheDocument();
    // Без подписки её раздела в кабинете нет.
    await expect(
      within(canvasElement).queryByRole("link", { name: "Подписка" }),
    ).not.toBeInTheDocument();
  },
};

/** Подписку не продают: раздел не зовёт на витрину, с которой нечего купить. */
export const NoGroundsNotOffered: Story = {
  ...purchasesPage(withoutGrounds, { subscriptionOffers: [] }),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Действующих оснований доступа нет."),
    ).toBeInTheDocument();
    await expect(
      page.queryByRole("link", { name: "Посмотреть тарифы" }),
    ).not.toBeInTheDocument();
  },
};

export const Loading: Story = {
  ...purchasesPage({ "/api/account/billing": pendingResponse }),
  globals: desktop,
  play: async ({ canvasElement }) => {
    await expect(
      await routeContent(canvasElement).findByText(
        "Загружаем основания доступа…",
      ),
    ).toBeInTheDocument();
  },
};

/** Сессия закончилась: раздел просит войти один раз и не показывает соседние блоки. */
export const SessionExpired: Story = {
  ...purchasesPage({
    "/api/account/billing": unauthorizedResponse,
    "/api/account/billing/contact": unauthorizedResponse,
    "/api/account/community-entry": unauthorizedResponse,
  }),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText(
        "Войдите, чтобы увидеть свои покупки и основания доступа.",
      ),
    ).toBeInTheDocument();
    await expect(page.getAllByRole("button", { name: /^Войти/u })).toHaveLength(
      1,
    );
    await expect(
      page.queryByRole("heading", { name: "Email для чеков и сообщений" }),
    ).not.toBeInTheDocument();
  },
};

export const Unavailable: Story = {
  ...purchasesPage({
    "/api/account/billing": () => billingFailureResponse("unavailable"),
  }),
  globals: desktop,
  play: async ({ canvasElement }) => {
    await expect(
      await routeContent(canvasElement).findByText(
        billingErrorMessage("unavailable"),
      ),
    ).toBeInTheDocument();
  },
};

export const ProductPurchase: Story = {
  ...purchasesPage({
    "/api/account/billing": () =>
      currentBillingResponse(null, {
        grounds: buyerGrounds,
        payments: buyerPayments,
      }),
  }),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("heading", { name: "Ваши продукты" }),
    ).toBeInTheDocument();
    await expect(
      page.getAllByRole("link", { name: "Открыть продукт" }),
    ).toHaveLength(2);
    await expect(page.queryByText("Сообщество Inside")).not.toBeInTheDocument();
    await expect(
      page.queryByRole("heading", { name: "Способ оплаты" }),
    ).not.toBeInTheDocument();
  },
};
export const ProductPurchaseMobile: Story = {
  ...ProductPurchase,
  globals: mobile,
};
