import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import type { PaymentPage } from "@/features/owner-payments";
import { getQueryClient } from "@/shared/api/query-client";
import { desktop, mobile } from "@/storybook/loads-in-place";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import {
  ownerPaymentBuyers,
  refundedPaymentPage,
  unknownPaymentPage,
} from "@/storybook/owner-payments.fixtures";
import {
  peopleIdentitiesResponse,
  type PeopleIdentitiesFake,
} from "@/storybook/people.fixtures";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { OrderEmailView, type OrderEmailState } from "./order-email.client";
import {
  SalesPaymentFailure,
  SalesPaymentLoading,
} from "./sales-payment-states";
import { SalesPaymentView } from "./sales-payment-view.client";

const environment = authoringPageEnvironment(
  `/authoring/sales/payments/${refundedPaymentPage.value.purchaseRef}`,
);
const loadMore = fn();
const confirmed = fn();
const openChanged = fn();

/** Подпись покупателя приходит отдельным чтением людей, как на маршруте. */
function buyerRead(fake: Partial<PeopleIdentitiesFake> = {}) {
  return () => {
    getQueryClient().removeQueries({ queryKey: ["authoring", "people"] });
    return fetchBeforeRender(
      (input) =>
        peopleIdentitiesResponse(input, {
          people: ownerPaymentBuyers(5),
          ...fake,
        }) ?? Promise.resolve(new Response(null, { status: 404 })),
    )();
  };
}

interface Args {
  readonly page: PaymentPage;
  readonly hasMoreAudit: boolean;
  readonly auditFailed: boolean;
  readonly dialogOpen: boolean;
  readonly reconcileError: string | null;
  readonly notice: string | null;
  readonly orderEmail: OrderEmailState;
}

/** Страница платежа с готовыми данными: тот же вид, что на маршруте. */
function PaymentScreen({
  page,
  hasMoreAudit,
  auditFailed,
  dialogOpen,
  reconcileError,
  notice,
  orderEmail,
}: Args) {
  const { audit, nextAuditAfter: _next, ...rest } = page;
  return (
    <SalesPaymentView
      audit={audit}
      auditContinuation={{
        failed: auditFailed,
        hasMore: hasMoreAudit,
        loading: false,
        onLoadMore: loadMore,
      }}
      orderEmail={
        <OrderEmailView
          onHide={fn()}
          onRetry={fn()}
          onShow={fn()}
          state={orderEmail}
        />
      }
      page={rest}
      reconcile={{
        error: reconcileError,
        notice,
        onConfirm: confirmed,
        onOpenChange: openChanged,
        open: dialogOpen,
        pending: false,
      }}
    />
  );
}

const meta = {
  ...environment,
  args: {
    page: refundedPaymentPage,
    hasMoreAudit: false,
    auditFailed: false,
    dialogOpen: false,
    reconcileError: null,
    notice: null,
    orderEmail: { kind: "hidden" },
  },
  beforeEach: [
    () => {
      loadMore.mockClear();
      confirmed.mockClear();
      openChanged.mockClear();
      return environment.beforeEach();
    },
    buyerRead(),
  ],
  component: PaymentScreen,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Платёж (#1718): банковское состояние и готовность доступа, суммы и возвраты, события банка, журнал операций с продолжением, сверка с банком после подтверждения и email заказа отдельным чтением.",
      },
    },
  },
  title: "Pages/Authoring/Платёж",
} satisfies Meta<typeof PaymentScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithRefunds: Story = {
  globals: desktop.globals,
  name: "С возвратом и событиями · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "AI Engineering: от промпта до продакшна",
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Оплачен", { selector: ".admin-badge" }),
    ).toBeVisible();
    await expect(page.getByText("Доступ открыт")).toBeVisible();
    await expect(
      page.getByText(
        "Компенсация без отказа: доступ сохраняется, продление не меняется",
      ),
    ).toBeVisible();
    await expect(page.getByText("Банк подтвердил оплату")).toBeVisible();
    await expect(
      page.getByText("Решение о возврате", { exact: false }),
    ).toBeVisible();
    await expect(
      await page.findByRole("link", { name: "Анна Петрова" }),
    ).toHaveAttribute(
      "href",
      `/authoring/people/${refundedPaymentPage.value.accountId}`,
    );
    await expect(page.getByText("@anna_petrova")).toBeVisible();
    // Email заказа не читается, пока его не попросили.
    await expect(page.queryByText(/@[\w.-]+\.test/u)).toBeNull();
    await expect(
      page.getByRole("button", { name: "Показать email" }),
    ).toBeVisible();
  },
};

export const WithRefundsMobile: Story = {
  ...WithRefunds,
  globals: mobile.globals,
  name: "С возвратом и событиями · телефон",
  play: async ({ canvasElement }) => {
    await expect(document.documentElement.scrollWidth).toBe(
      document.documentElement.clientWidth,
    );
    await expect(
      routeContent(canvasElement).getByRole("button", {
        name: "Сверить с банком",
      }),
    ).toBeVisible();
  },
};

const buyerWithoutContacts: PaymentPage = {
  ...unknownPaymentPage,
  value: {
    ...unknownPaymentPage.value,
    accountId: "55555555-0000-4000-8000-000000000003",
  },
};

export const BuyerWithoutContacts: Story = {
  args: { page: buyerWithoutContacts },
  globals: desktop.globals,
  name: "Покупатель без контактов · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      await page.findByRole("link", { name: "Аккаунт без контактов" }),
    ).toHaveAttribute(
      "href",
      `/authoring/people/${buyerWithoutContacts.value.accountId}`,
    );
    await expect(page.getByText("ID 55555555")).toBeVisible();
    await expect(
      page.queryByText(buyerWithoutContacts.value.accountId),
    ).toBeNull();
  },
};

export const BuyerWithoutContactsMobile: Story = {
  ...BuyerWithoutContacts,
  globals: mobile.globals,
  name: "Покупатель без контактов · телефон",
};

export const UnknownState: Story = {
  args: { page: unknownPaymentPage },
  globals: desktop.globals,
  name: "Итог банка неизвестен · широкий экран",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByText("Неизвестно, нужна сверка", { selector: ".admin-badge" }),
    ).toHaveAttribute("data-tone", "attention");
    await expect(
      page.getByText("Банк не сообщил итог этой оплаты", { exact: false }),
    ).toBeVisible();
    await expect(page.getAllByText("Уточняется в банке")).toHaveLength(2);
    await expect(page.queryByText("Доступ открыт")).toBeNull();
    await userEvent.click(
      page.getByRole("button", { name: "Сверить с банком" }),
    );
    await expect(openChanged).toHaveBeenCalledWith(true);
  },
};

export const UnknownStateMobile: Story = {
  ...UnknownState,
  globals: mobile.globals,
  name: "Итог банка неизвестен · телефон",
};

export const ReconcileConfirmation: Story = {
  args: { page: unknownPaymentPage, dialogOpen: true },
  globals: desktop.globals,
  name: "Подтверждение сверки",
  play: async () => {
    const dialog = within(document.body).getByRole("dialog", {
      name: "Сверить платёж с банком?",
    });
    await expect(
      within(dialog).getByText("Деньги не списываются", { exact: false }),
    ).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Сверить с банком" }),
    );
    await expect(confirmed).toHaveBeenCalledTimes(1);
  },
};

export const ReconcileFailed: Story = {
  args: {
    page: unknownPaymentPage,
    dialogOpen: true,
    reconcileError:
      "Банк сейчас не ответил. Платёж не изменился, повторите сверку позже.",
  },
  globals: mobile.globals,
  name: "Сверка не прошла · телефон",
  play: async () => {
    await expect(within(document.body).getByRole("alert")).toHaveTextContent(
      "Банк сейчас не ответил",
    );
  },
};

export const AuditContinues: Story = {
  args: { hasMoreAudit: true },
  globals: desktop.globals,
  name: "Журнал с продолжением",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      routeContent(canvasElement).getByRole("button", {
        name: "Показать ещё записи",
      }),
    );
    await expect(loadMore).toHaveBeenCalledTimes(1);
  },
};

export const AuditContinuationFailed: Story = {
  args: { auditFailed: true },
  globals: desktop.globals,
  name: "Продолжение журнала не прочиталось",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(page.getByRole("alert")).toHaveTextContent(
      "Прочитанные остаются на месте",
    );
    await expect(
      page.getByRole("button", { name: "Повторить чтение журнала" }),
    ).toBeVisible();
  },
};

export const Loading: Story = {
  globals: desktop.globals,
  name: "Загрузка · широкий экран",
  render: () => <SalesPaymentLoading />,
};

export const LoadingMobile: Story = {
  ...Loading,
  globals: mobile.globals,
  name: "Загрузка · телефон",
};

export const NotFound: Story = {
  globals: desktop.globals,
  name: "Платёж не найден",
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { name: "Платёж не найден" }),
    ).toBeVisible();
    await expect(
      page.getAllByRole("link", { name: "Все платежи" }).length,
    ).toBeGreaterThan(0);
  },
  render: () => (
    <SalesPaymentFailure onRetry={fn()} state={{ kind: "not_found" }} />
  ),
};

export const Unavailable: Story = {
  globals: mobile.globals,
  name: "Ошибка · телефон",
  render: () => (
    <SalesPaymentFailure
      onRetry={fn()}
      state={{ kind: "unavailable", reference: "dependency-unavailable" }}
    />
  ),
};
