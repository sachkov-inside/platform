import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";

import {
  billingErrorMessage,
  type SubscriptionView,
} from "@/entities/subscription";
import {
  pendingResponse,
  respondByPath,
  type RouteResponse,
  subscribedMemberRoutes,
  unauthorizedResponse,
} from "@/storybook/account.fixtures";
import {
  activeSubscription,
  billingContactResponse,
  billingFailureResponse,
  canceledSubscription,
  communityAdmissionResponse,
  courseEnrollment,
  currentBillingResponse,
  enrollmentsResponse,
} from "@/storybook/billing.fixtures";
import {
  accountSectionEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { AccountSubscriptionPage } from "./account-subscription-page.client";

const path = "/account/subscription";

const desktop = {
  viewport: { isRotated: false, value: "desktop1440" },
} as const;
const mobile = { viewport: { isRotated: false, value: "mobile390" } } as const;

/** Ответы раздела у участника с подпиской: назначение тарифа, право на сообщество и контакт. */
const subscriptionRoutes: Readonly<Record<string, RouteResponse>> = {
  ...subscribedMemberRoutes,
  "/api/account/billing/enrollments": () =>
    enrollmentsResponse([courseEnrollment]),
  "/api/account/billing/community-admission": () =>
    communityAdmissionResponse("ready"),
  "/api/account/billing/contact": () => billingContactResponse(),
};

/**
 * Раздел в кабинете; `routes` заменяет ответы участника с подпиской там, где story их меняет, и
 * создаётся заново на каждый показ.
 */
function subscriptionPage(
  routes: () => Readonly<Record<string, RouteResponse>> = () => ({}),
  options: Parameters<typeof accountSectionEnvironment>[1] = {},
): Pick<Story, "beforeEach" | "decorators" | "parameters"> {
  return accountSectionEnvironment(path, {
    ...options,
    fetch: () => respondByPath({ ...subscriptionRoutes, ...routes() }),
  });
}

/** Подписки нет, назначений тоже: раздел открыт по прямому адресу. */
const withoutSubscription = () => ({
  "/api/account/billing": () => currentBillingResponse(null),
  "/api/account/billing/enrollments": () => enrollmentsResponse([]),
  "/api/account/billing/community-admission": () =>
    communityAdmissionResponse("no_access"),
});

const meta = {
  title: "Pages/Account/Subscription",
  component: AccountSubscriptionPage,
  parameters: {
    docs: {
      description: {
        component:
          "Раздел «Подписка» маршрута `/account/subscription`: назначенные тарифы и право на сообщество, тариф, оплаченный срок, следующее списание и управление продлением, документы подписки. Способ оплаты и история денег принадлежат разделу «Покупки».",
      },
    },
  },
} satisfies Meta<typeof AccountSubscriptionPage>;
export default meta;
type Story = StoryObj<typeof meta>;

async function expectActiveSubscription(canvasElement: HTMLElement) {
  const page = routeContent(canvasElement);
  await expect(
    page.getByRole("heading", { level: 1, name: "Подписка" }),
  ).toBeInTheDocument();
  await expect(
    await page.findByText("Право на сообщество подтверждено."),
  ).toBeInTheDocument();
  await expect(
    page.getByRole("heading", { name: "Ваши тарифы" }),
  ).toBeInTheDocument();
  await expect(
    await page.findByRole("button", { name: "Отменить продление" }),
  ).toBeEnabled();
  // «Действует» стоит и у подписки, и у назначенного тарифа.
  await expect(page.getAllByText("Действует")).toHaveLength(2);
  await expect(
    page.getByText(/Условия подписки и порядок обращений/u),
  ).toBeInTheDocument();
  // Способ оплаты — задача раздела «Покупки».
  await expect(page.queryByText("Способ оплаты")).not.toBeInTheDocument();
}

export const ActiveDesktop: Story = {
  ...subscriptionPage(),
  globals: desktop,
  play: async ({ canvasElement }) => {
    await expectActiveSubscription(canvasElement);
  },
};

export const ActiveMobile: Story = {
  ...subscriptionPage(),
  globals: mobile,
  play: async ({ canvasElement }) => {
    await expectActiveSubscription(canvasElement);
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  },
};

/** Отмена продления: команда возвращает новый вид подписки, и раздел сразу его показывает. */
export const CancelRenewal: Story = {
  ...subscriptionPage(() => {
    let subscription: SubscriptionView = activeSubscription;
    return {
      "/api/account/billing": () => currentBillingResponse(subscription),
      "/api/account/billing/subscription/cancel": () => {
        subscription = canceledSubscription;
        return Response.json({ ok: true, value: canceledSubscription });
      },
    };
  }),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await userEvent.click(
      await page.findByRole("button", { name: "Отменить продление" }),
    );
    await expect(
      await page.findByText("Списаний больше не будет"),
    ).toBeInTheDocument();
    await expect(
      page.getByRole("button", { name: "Возобновить автопродление" }),
    ).toBeEnabled();
  },
};

/** Подписки нет, её продают: раздел зовёт на витрину. */
export const NoSubscription: Story = {
  ...subscriptionPage(withoutSubscription),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Автопродление Inside не подключено"),
    ).toBeInTheDocument();
    await expect(
      page.getByRole("link", { name: "Посмотреть тарифы" }),
    ).toHaveAttribute("href", "/subscription");
    await expect(
      await page.findByText("Действующего права на сообщество нет."),
    ).toBeInTheDocument();
  },
};

/** Подписку не продают: раздел объясняет, что её нет, но не зовёт на пустую витрину. */
export const NoSubscriptionNotOffered: Story = {
  ...subscriptionPage(withoutSubscription, { subscriptionOffers: [] }),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Автопродление Inside не подключено"),
    ).toBeInTheDocument();
    await expect(
      page.queryByRole("link", { name: "Посмотреть тарифы" }),
    ).not.toBeInTheDocument();
  },
};

/**
 * Назначения не прочитались: чтение повторяется само несколько раз, затем раздел говорит об этом и
 * даёт повторить. Подписка при этом видна.
 */
export const EnrollmentsUnavailable: Story = {
  ...subscriptionPage(() => ({
    "/api/account/billing/enrollments": () =>
      billingFailureResponse("unavailable"),
  })),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole(
        "button",
        { name: "Повторить загрузку" },
        { timeout: 15_000 },
      ),
    ).toBeInTheDocument();
    await expect(
      await page.findByRole("button", { name: "Отменить продление" }),
    ).toBeEnabled();
  },
};

export const Loading: Story = {
  ...subscriptionPage(() => ({
    "/api/account/billing": pendingResponse,
    "/api/account/billing/enrollments": pendingResponse,
  })),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Загружаем подписку…"),
    ).toBeInTheDocument();
    await expect(page.getByText("Загружаем назначения…")).toBeInTheDocument();
  },
};

/** Сессия закончилась: раздел просит войти и возвращает сюда же. */
export const SessionExpired: Story = {
  ...subscriptionPage(() => ({
    "/api/account/billing": unauthorizedResponse,
    "/api/account/billing/enrollments": unauthorizedResponse,
    "/api/account/billing/community-admission": unauthorizedResponse,
    "/api/account/billing/contact": unauthorizedResponse,
  })),
  globals: desktop,
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByText("Войдите, чтобы увидеть свою подписку."),
    ).toBeInTheDocument();
    await expect(
      page.getByRole("button", { name: "Войти" }).closest("form"),
    ).toHaveAttribute("action", "/auth/sign-in");
  },
};

export const Unavailable: Story = {
  ...subscriptionPage(() => ({
    "/api/account/billing": () => billingFailureResponse("unavailable"),
  })),
  globals: desktop,
  play: async ({ canvasElement }) => {
    await expect(
      await routeContent(canvasElement).findByText(
        billingErrorMessage("unavailable"),
      ),
    ).toBeInTheDocument();
  },
};
