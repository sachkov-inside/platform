import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import {
  guideOnlyOffer,
  guideQuote,
  legalDocuments,
  verifiedContact,
} from "@/workshop/billing.fixtures";
import { fetchBeforeRender } from "@/workshop/mutation-mock";
import { publicPageEnvironment } from "@/workshop/story-environment";

import { oneTimePurchaseInclusions } from "../model/one-time-terms";
import { CheckoutFlow } from "./checkout-flow.client";

const environment = publicPageEnvironment("/guides/platform-inside/buy");

/** Какие маршруты собственного BFF вызвал поток: по ним видно, что оплата не начиналась. */
const requestPath = fn();

/** Ответы собственного BFF в том же конверте, что отдают маршруты `/api/account/billing/*`. */
const editionReplaced = fetchBeforeRender((input) => {
  const target = input instanceof Request ? input.url : String(input);
  const path = new URL(target, window.location.origin).pathname;
  requestPath(path);
  if (path === "/api/account/billing/quote")
    return Promise.resolve(Response.json({ ok: true, value: guideQuote }));
  if (path === "/api/account/billing/consents")
    return Promise.resolve(Response.json({ ok: false, code: "document_changed" }));
  return Promise.resolve(Response.json({ ok: false, code: "unavailable" }));
});

const meta = {
  ...environment,
  title: "Pages/Guide/Payment/Flow",
  component: CheckoutFlow,
  args: {
    snapshot: guideOnlyOffer,
    contact: verifiedContact,
    documents: legalDocuments,
    contactHref: "/account/email",
    inclusions: oneTimePurchaseInclusions(guideOnlyOffer),
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
 * Согласие дано на редакцию, которую сервер уже заменил: отметка снимается, покупатель видит
 * причину, документы перечитываются, а оплата не начинается.
 */
export const EditionChangedBeforePayment: Story = {
  beforeEach: editionReplaced,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const consent = await canvas.findByRole("checkbox", {
      name: /Принимаю оферту разовой покупки/u,
    });
    await userEvent.click(consent);
    const pay = canvas.getByRole("button", { name: /Купить за/u });
    await waitFor(() => expect(pay).toBeEnabled());
    await userEvent.click(pay);

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Условия покупки обновились",
    );
    await expect(consent).not.toBeChecked();
    await expect(args.onDocumentsChanged).toHaveBeenCalledTimes(1);
    // Отказ по согласию наступает до оплаты: команда покупки не отправлялась.
    await expect(requestPath).toHaveBeenCalledWith("/api/account/billing/consents");
    await expect(requestPath).not.toHaveBeenCalledWith("/api/account/billing/purchase");
    await expect(canvas.getByRole("button", { name: /Купить за/u })).toBeDisabled();
  },
};
