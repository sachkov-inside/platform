import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { z } from "zod";

import {
  productOnlyOffer,
  productWithSupportOffer,
  productQuote,
  supportOffer,
  verifiedContact,
  legalDocuments,
  pendingPurchase,
  productWithSupportQuote,
  savedQuote,
} from "@/storybook/billing.fixtures";
import { fetchBeforeRender } from "@/storybook/mutation-mock";
import { publicPageEnvironment } from "@/storybook/story-environment";

import { purchaseInputSchema } from "../model/checkout";
import { CheckoutFlow, type CheckoutFlowProps } from "./checkout-flow.client";

const environment = publicPageEnvironment("/products/platform-inside/buy");

function SelectionScenario(args: CheckoutFlowProps) {
  const [snapshot, setSnapshot] = useState(args.snapshot);
  const [contact, setContact] = useState(args.contact);
  const [promoCode, setPromoCode] = useState(args.promoCode);
  return (
    <>
      <div aria-label="Изменить условия сценария">
        <button
          onClick={() => {
            setSnapshot(productOnlyOffer);
          }}
        >
          Вариант A
        </button>
        <button
          onClick={() => {
            setSnapshot(productWithSupportOffer);
          }}
        >
          Вариант B
        </button>
        <button
          onClick={() => {
            setSnapshot(supportOffer);
          }}
        >
          Подписка
        </button>
        <button
          onClick={() => {
            setSnapshot({
              ...snapshot,
              paymentOption: { ...snapshot.paymentOption, revision: 2 },
            });
          }}
        >
          Новая редакция
        </button>
        <button
          onClick={() => {
            setContact({
              ...verifiedContact,
              revision: 3,
              email: "new@example.test",
            });
          }}
        >
          Новый контакт
        </button>
        <button
          onClick={() => {
            setPromoCode("another-code");
          }}
        >
          Новый промокод
        </button>
      </div>
      <CheckoutFlow
        {...args}
        snapshot={snapshot}
        contact={contact}
        {...(promoCode === undefined ? {} : { promoCode })}
      />
    </>
  );
}

function commandBody(init: RequestInit | undefined): unknown {
  const form = init?.body;
  const value = form instanceof FormData ? form.get("input") : null;
  if (typeof value !== "string") throw new Error("missing command input");
  return JSON.parse(value);
}

const quoteRequest = fn();
const purchaseRequest = fn();
const consentRequest = fn();
const releaseLateQuote = fn<() => void>();
const commandSchema = z.object({
  paymentOptionId: z.uuid(),
  optionRevision: z.number(),
  promoCode: z.string().optional(),
});

const meta = {
  ...environment,
  title: "Pages/Product/Payment/Recovery",
  component: CheckoutFlow,
  render: (args) => <SelectionScenario {...args} />,
  args: {
    snapshot: productOnlyOffer,
    contact: verifiedContact,
    documents: legalDocuments,
    contactHref: "/account/email",
    onNavigate: fn(),
    onPurchase: fn(),
  },
  beforeEach: () => {
    environment.beforeEach();
    quoteRequest.mockClear();
    purchaseRequest.mockClear();
    consentRequest.mockClear();
    releaseLateQuote.mockReset();
  },
} satisfies Meta<typeof CheckoutFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

const failedReplacement = fetchBeforeRender((input, init) => {
  const path = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin,
  ).pathname;
  if (path !== "/api/account/billing/quote")
    return Promise.resolve(Response.json({ ok: false, code: "unavailable" }));
  const command = commandSchema.parse(commandBody(init));
  quoteRequest(command);
  return Promise.resolve(
    Response.json(
      command.paymentOptionId === productOnlyOffer.paymentOption.id &&
        command.optionRevision === 1 &&
        command.promoCode === undefined
        ? { ok: true, value: productQuote }
        : { ok: false, code: "option_changed" },
    ),
  );
});

export const FailedReplacementCannotPayOldQuote: Story = {
  beforeEach: failedReplacement,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(
        canvas.getByRole("button", {
          name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
        }),
      ).toBeEnabled(),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Вариант B" }));
    await canvas.findByRole("alert");
    await expect(
      canvas.getByRole("button", {
        name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
      }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Обновить условия" }),
    ).toBeEnabled();
  },
};

export const SubscriptionRequiresItsOwnQuote: Story = {
  beforeEach: failedReplacement,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(
        canvas.getByRole("button", {
          name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
        }),
      ).toBeEnabled(),
    );
    await userEvent.click(canvas.getByRole("button", { name: /^Подписка$/u }));
    await expect(
      canvas.getByRole("heading", { name: "Оформление подписки" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Рассчитать условия" }),
    ).toBeEnabled();
    await userEvent.click(
      canvas.getByRole("button", { name: "Рассчитать условия" }),
    );
    await canvas.findByRole("alert");
    await expect(quoteRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        paymentOptionId: supportOffer.paymentOption.id,
      }),
    );
    await expect(
      canvas.queryByRole("button", {
        name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
      }),
    ).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Вариант A" }));
    await waitFor(() =>
      expect(
        canvas.getByRole("button", {
          name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
        }),
      ).toBeEnabled(),
    );
  },
};

function lostPurchaseResponse(state: "pending" | "unknown" = "pending") {
  let original: unknown;
  let quotedSnapshot = productOnlyOffer;
  let purchasedSnapshot = productOnlyOffer;
  return fetchBeforeRender((input, init) => {
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    ).pathname;
    const body = commandBody(init);
    if (path === "/api/account/billing/quote") {
      const command = commandSchema.parse(body);
      const quoted =
        command.paymentOptionId === supportOffer.paymentOption.id
          ? savedQuote
          : command.paymentOptionId === productWithSupportOffer.paymentOption.id
            ? productWithSupportQuote
            : productQuote;
      quotedSnapshot = quoted.snapshot;
      quoteRequest(command);
      return Promise.resolve(Response.json({ ok: true, value: quoted }));
    }
    if (path === "/api/account/billing/consents") {
      consentRequest(body);
      return Promise.resolve(
        Response.json({
          ok: true,
          value: {
            ok: true,
            evidenceRefs: ["00000000-0000-4000-8000-000000000801"],
          },
        }),
      );
    }
    if (path === "/api/account/billing/purchase") {
      purchaseRequest(purchaseInputSchema.parse(body));
      if (original === undefined) {
        original = body;
        purchasedSnapshot = quotedSnapshot;
        return Promise.reject(new TypeError("synthetic lost response"));
      }
      if (JSON.stringify(body) !== JSON.stringify(original))
        return Promise.resolve(
          Response.json({ ok: false, code: "existing_access" }),
        );
      return Promise.resolve(
        Response.json({
          ok: true,
          value: {
            ...pendingPurchase,
            state,
            snapshot: purchasedSnapshot,
            paymentUrl: state === "unknown" ? null : pendingPurchase.paymentUrl,
          },
        }),
      );
    }
    return Promise.resolve(Response.json({ ok: false, code: "unavailable" }));
  })();
}

export const LostResponseThenContactChange: Story = {
  beforeEach: () => lostPurchaseResponse(),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(
        canvas.getByRole("button", {
          name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
        }),
      ).toBeEnabled(),
    );
    await userEvent.click(
      canvas.getByRole("button", {
        name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
      }),
    );
    await canvas.findByRole("alert");
    const original: unknown = purchaseRequest.mock.calls[0]?.[0];
    await userEvent.click(
      canvas.getByRole("button", { name: "Новый контакт" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Повторить первоначальную покупку" }),
    );
    await waitFor(() => expect(purchaseRequest).toHaveBeenCalledTimes(2));
    await expect(purchaseRequest).toHaveBeenLastCalledWith(original);
    await expect(consentRequest).toHaveBeenCalledTimes(1);
    await expect(args.onPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseRef: pendingPurchase.purchaseRef,
        state: "pending",
      }),
    );
  },
};

function replacementTest(change: "Новая редакция" | "Новый промокод"): Story {
  return {
    beforeEach: failedReplacement,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      await waitFor(() =>
        expect(
          canvas.getByRole("button", {
            name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
          }),
        ).toBeEnabled(),
      );
      await userEvent.click(canvas.getByRole("button", { name: change }));
      await canvas.findByRole("alert");
      await expect(
        canvas.getByRole("button", {
          name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
        }),
      ).toBeDisabled();
      await expect(quoteRequest).toHaveBeenLastCalledWith(
        expect.objectContaining(
          change === "Новая редакция"
            ? { optionRevision: 2 }
            : { promoCode: "another-code" },
        ),
      );
    },
  };
}
export const RevisionInvalidatesQuote: Story =
  replacementTest("Новая редакция");
export const PromoInvalidatesQuote: Story = replacementTest("Новый промокод");

function retryChangedConditions(
  subscription: boolean,
  state: "pending" | "unknown",
): Story {
  return {
    args: { snapshot: subscription ? supportOffer : productOnlyOffer },
    beforeEach: () => lostPurchaseResponse(state),
    play: async ({ canvasElement, args }) => {
      const canvas = within(canvasElement);
      if (subscription)
        await userEvent.click(
          canvas.getByRole("button", { name: "Рассчитать условия" }),
        );
      await waitFor(() =>
        expect(
          canvas.getByRole("button", {
            name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
          }),
        ).toBeEnabled(),
      );
      await userEvent.click(
        canvas.getByRole("button", {
          name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
        }),
      );
      await canvas.findByRole("alert");
      const original: unknown = purchaseRequest.mock.calls[0]?.[0];
      await userEvent.click(
        canvas.getByRole("button", { name: "Новый контакт" }),
      );
      await userEvent.click(canvas.getByRole("button", { name: "Вариант B" }));
      await userEvent.click(
        canvas.getByRole("button", { name: "Новый промокод" }),
      );
      await waitFor(() =>
        expect(quoteRequest).toHaveBeenLastCalledWith(
          expect.objectContaining({
            paymentOptionId: productWithSupportOffer.paymentOption.id,
            promoCode: "another-code",
          }),
        ),
      );
      await expect(
        canvas.getByRole("button", {
          name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
        }),
      ).toBeDisabled();
      await userEvent.click(
        canvas.getByRole("button", {
          name: "Повторить первоначальную покупку",
        }),
      );
      await waitFor(() =>
        expect(args.onPurchase).toHaveBeenCalledWith(
          expect.objectContaining({
            purchaseRef: pendingPurchase.purchaseRef,
            state,
          }),
        ),
      );
      await expect(purchaseRequest).toHaveBeenCalledTimes(2);
      await expect(purchaseRequest).toHaveBeenLastCalledWith(original);
      await expect(consentRequest).toHaveBeenCalledTimes(1);
      await expect(
        canvas.queryByRole("button", {
          name: "Повторить первоначальную покупку",
        }),
      ).not.toBeInTheDocument();
      await waitFor(() =>
        expect(
          canvas.getByRole("button", {
            name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
          }),
        ).toBeEnabled(),
      );
      // Восстановленный receipt завершил доставку. Новую покупку допускает серверная политика.
      await userEvent.click(
        canvas.getByRole("button", {
          name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
        }),
      );
      await canvas.findByText("Этот продукт у вас уже открыт.");
      await expect(purchaseRequest).toHaveBeenCalledTimes(3);
      const next = purchaseInputSchema.parse(
        purchaseRequest.mock.calls[2]?.[0],
      );
      const first = purchaseInputSchema.parse(original);
      await expect(next.operationId).not.toBe(first.operationId);
      await expect(next.contactRevision).toBe(3);
      await expect(next.quoteRef).toBe(productWithSupportQuote.quoteRef);
      await expect(
        canvas.getByRole("button", {
          name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
        }),
      ).toBeDisabled();
    },
  };
}

export const OneTimeRecoversPendingAfterSelectionChange: Story =
  retryChangedConditions(false, "pending");
export const OneTimeRecoversUnknownAfterSelectionChange: Story =
  retryChangedConditions(false, "unknown");
export const SubscriptionRecoversPendingAfterSelectionChange: Story =
  retryChangedConditions(true, "pending");
export const SubscriptionRecoversUnknownAfterSelectionChange: Story =
  retryChangedConditions(true, "unknown");

export const LateQuoteCannotRestorePreviousSelection: Story = {
  args: { snapshot: supportOffer },
  beforeEach: () => {
    let deliverA: (() => void) | undefined;
    let rejectFirstB = true;
    let consumedA: (() => void) | undefined;
    const aConsumed = new Promise<void>((resolve) => {
      consumedA = resolve;
    });
    releaseLateQuote.mockImplementation(() => {
      deliverA?.();
    });
    return fetchBeforeRender((input, init) => {
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      ).pathname;
      if (path !== "/api/account/billing/quote")
        return Promise.resolve(
          Response.json({ ok: false, code: "unavailable" }),
        );
      const command = commandSchema.parse(commandBody(init));
      quoteRequest(command);
      if (command.paymentOptionId === supportOffer.paymentOption.id) {
        return new Promise<Response>((resolve) => {
          deliverA = () => {
            const response = Response.json({ ok: true, value: savedQuote });
            const read = response.json.bind(response);
            response.json = async () => {
              const body: unknown = await read();
              consumedA?.();
              return body;
            };
            resolve(response);
          };
        });
      }
      if (rejectFirstB) {
        rejectFirstB = false;
        return Promise.resolve(
          Response.json({ ok: false, code: "option_changed" }),
        );
      }
      // Следующий отказ B доставляется после чтения позднего A, чтобы финальная ошибка
      // стала наблюдаемой границей этого сценария, а не ожиданием по времени.
      return aConsumed.then(() =>
        Response.json({ ok: false, code: "option_changed" }),
      );
    })();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Рассчитать условия" }),
    );
    await waitFor(() => expect(quoteRequest).toHaveBeenCalledTimes(1));
    await userEvent.click(canvas.getByRole("button", { name: "Вариант B" }));
    await canvas.findByRole("alert");
    await userEvent.click(
      canvas.getByRole("button", { name: "Обновить условия" }),
    );
    await waitFor(() => expect(quoteRequest).toHaveBeenCalledTimes(3));
    releaseLateQuote();
    await canvas.findByRole("alert");
    await expect(
      canvas.getByRole("button", {
        name: /^(?:Оплатить |Оформить подписку и оплатить )/u,
      }),
    ).toBeDisabled();
    await expect(
      canvas.getByRole("button", { name: "Обновить условия" }),
    ).toBeEnabled();
  },
};
