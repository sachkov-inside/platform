import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import type { BillingQuote } from "@/entities/subscription";
import {
  productOnlyOffer,
  productQuote,
  legalDocuments,
  verifiedContact,
  pendingPurchase,
} from "@/storybook/billing.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { CheckoutFlow } from "./checkout-flow.client";

const environment = publicPageEnvironment("/products/platform-inside/buy");

/** Какие маршруты собственного BFF вызвал поток: по ним видно, что оплата не начиналась. */
const requestPath = fn();

/** Ответы собственного BFF в том же конверте, что отдают маршруты `/api/account/billing/*`. */
const editionReplaced = fetchBeforeRender((input) => {
  const target = input instanceof Request ? input.url : String(input);
  const path = new URL(target, window.location.origin).pathname;
  requestPath(path);
  if (path === "/api/account/billing/quote")
    return Promise.resolve(Response.json({ ok: true, value: productQuote }));
  if (path === "/api/account/billing/consents")
    return Promise.resolve(
      Response.json({ ok: false, code: "document_changed" }),
    );
  return Promise.resolve(Response.json({ ok: false, code: "unavailable" }));
});

const meta = {
  ...environment,
  title: "Pages/Product/Payment/Flow",
  component: CheckoutFlow,
  args: {
    snapshot: productOnlyOffer,
    contact: verifiedContact,
    documents: legalDocuments,
    showInclusions: true,
    onDocumentsChanged: fn(),
    onNavigate: fn(),
  },
  beforeEach: () => {
    environment.beforeEach();
    requestPath.mockClear();
  },
} satisfies Meta<typeof CheckoutFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Кнопка приняла редакцию, которую сервер уже заменил: покупатель видит причину, документы
 * перечитываются, а оплата не начинается.
 */
export const EditionChangedBeforePayment: Story = {
  beforeEach: editionReplaced,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("checkbox")).not.toBeInTheDocument();
    const pay = await canvas.findByRole("button", { name: /^Оплатить /u });
    await waitFor(() => expect(pay).toBeEnabled());
    await userEvent.click(pay);

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Условия покупки обновились",
    );
    await expect(args.onDocumentsChanged).toHaveBeenCalledTimes(1);
    // Отказ по согласию наступает до оплаты: команда покупки не отправлялась.
    await expect(requestPath).toHaveBeenCalledWith(
      "/api/account/billing/consents",
    );
    await expect(requestPath).not.toHaveBeenCalledWith(
      "/api/account/billing/purchase",
    );
    // Следующее нажатие примет перечитанную действующую редакцию.
    await expect(
      canvas.getByRole("button", { name: /^Оплатить /u }),
    ).toBeEnabled();
  },
};

/** Тело последнего запроса расчёта: по нему видно, что код ссылки ушёл на сервер. */
const quoteBody = fn();

function personalLinkQuote(promotion: BillingQuote["snapshot"]["promotion"]) {
  return fetchBeforeRender((input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    const path = new URL(target, window.location.origin).pathname;
    requestPath(path);
    if (path === "/api/account/billing/quote") {
      // Клиент шлёт команду полем `input` формы, как настоящий маршрут BFF.
      const form = init?.body;
      const command = form instanceof FormData ? form.get("input") : null;
      if (typeof command === "string") quoteBody(JSON.parse(command));
      return Promise.resolve(
        Response.json({
          ok: true,
          value: {
            ...productQuote,
            snapshot: {
              ...productQuote.snapshot,
              promotion,
              firstPriceKopecks:
                promotion === null
                  ? productQuote.snapshot.firstPriceKopecks
                  : productQuote.snapshot.firstPriceKopecks / 2,
            },
          },
        }),
      );
    }
    return Promise.resolve(Response.json({ ok: false, code: "unavailable" }));
  });
}

/** Персональная ссылка владельца: код уходит в расчёт, и покупатель видит цену со скидкой (#815). */
export const PersonalLinkDiscount: Story = {
  args: { promoCode: "survey-7f3a" },
  beforeEach: personalLinkQuote({
    id: "00000000-0000-4000-8000-000000000701",
    revision: 1,
    name: "Скидка респонденту",
    percent: 50,
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Скидка респонденту · −50%"),
    ).toBeInTheDocument();
    await expect(quoteBody).toHaveBeenLastCalledWith(
      expect.objectContaining({ promoCode: "survey-7f3a" }),
    );
    await expect(
      canvas.queryByText(/Скидка по ссылке не применилась/u),
    ).not.toBeInTheDocument();
  },
};

/** Код израсходован или истёк: цена обычная, и покупатель знает почему. */
export const PersonalLinkRejected: Story = {
  args: { promoCode: "survey-used" },
  beforeEach: personalLinkQuote(null),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(/Скидка по ссылке не применилась/u),
    ).toBeInTheDocument();
    await expect(quoteBody).toHaveBeenLastCalledWith(
      expect.objectContaining({ promoCode: "survey-used" }),
    );
  },
};

const purchaseCommand = fn();
const emailCheckout = fetchBeforeRender((input, init) => {
  const target = input instanceof Request ? input.url : String(input);
  const path = new URL(target, window.location.origin).pathname;
  requestPath(path);
  if (path === "/api/account/billing/quote")
    return Promise.resolve(Response.json({ ok: true, value: productQuote }));
  if (path === "/api/account/billing/consents")
    return Promise.resolve(
      Response.json({
        ok: true,
        value: {
          ok: true,
          evidenceRefs: ["40000000-0000-4000-8000-000000000001"],
        },
      }),
    );
  if (path === "/api/account/billing/purchase") {
    const form = init?.body;
    const command = form instanceof FormData ? form.get("input") : null;
    if (typeof command === "string") purchaseCommand(JSON.parse(command));
    return Promise.resolve(Response.json({ ok: true, value: pendingPurchase }));
  }
  return Promise.resolve(Response.json({ ok: false, code: "unavailable" }));
});

export const EmailWithoutCode: Story = {
  args: { contact: null },
  beforeEach: emailCheckout,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const pay = await canvas.findByRole("button", { name: /^Оплатить /u });
    await waitFor(() => expect(pay).toBeEnabled());
    await userEvent.click(pay);
    const email = canvas.getByRole("textbox", { name: "Email" });
    await expect(email).toHaveFocus();
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(canvas.getByRole("alert")).toHaveTextContent("Введите email");
    await expect(requestPath).not.toHaveBeenCalledWith(
      "/api/account/billing/consents",
    );
    await userEvent.type(email, "broken");
    await userEvent.click(pay);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Проверьте email",
    );
    await userEvent.clear(email);
    await userEvent.type(email, "Order@Example.test{Enter}");
    await waitFor(() =>
      expect(purchaseCommand).toHaveBeenLastCalledWith(
        expect.objectContaining({ email: "order@example.test" }),
      ),
    );
    await expect(requestPath).not.toHaveBeenCalledWith(
      "/api/account/billing/contact/start",
    );
    await expect(requestPath).not.toHaveBeenCalledWith(
      "/api/account/billing/contact/confirm",
    );
    await expect(args.onNavigate).toHaveBeenCalled();
  },
};

export const AccountEmailPrefilled: Story = {
  args: { contact: null, initialEmail: "login@example.test" },
  beforeEach: emailCheckout,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole("textbox", { name: "Email" }),
    ).not.toBeInTheDocument();
    const pay = await canvas.findByRole("button", { name: /^Оплатить /u });
    await waitFor(() => expect(pay).toBeEnabled());
    await userEvent.click(pay);
    await waitFor(() =>
      expect(purchaseCommand).toHaveBeenLastCalledWith(
        expect.objectContaining({ email: "login@example.test" }),
      ),
    );
  },
};
