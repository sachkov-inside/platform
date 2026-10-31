import { describe, expect, it } from "vitest";

import type { PaymentView } from "@/features/owner-payments/model/payment-contract";
import {
  emptyPaymentsQuery,
  hasPaymentsFilters,
  parsePaymentsListRequest,
  parsePaymentsSearchParams,
  paymentStates,
  personPaymentsHref,
  paymentsListRequest,
  paymentsPeriodLabel,
  salesPaymentsQueryHref,
  serializePaymentsListRequest,
  serializePaymentsQuery,
  withPaymentsCursor,
  withPaymentsFilter,
  type PaymentsQuery,
} from "@/features/owner-payments/model/payment-filters";
import {
  paymentAccessBadge,
  paymentEventLabel,
  paymentProductName,
  paymentStateBadge,
  paymentStateLabels,
  refundAmountText,
} from "@/features/owner-payments/model/payment-presentation";
import { paymentsFilterChips } from "@/features/owner-payments/ui/payment-filters.client";
import {
  authoringPaymentHref,
  authoringPersonHref,
} from "@/shared/routing/authoring";
import { adminStates } from "@/shared/ui/admin";
import { ownerPayment } from "@/storybook/owner-payments.fixtures";
import {
  authoringLocation,
  authoringMobileTabs,
  authoringNavigation,
} from "@/widgets/authoring-shell/model/navigation";

const productId = "70000000-0000-4000-8000-000000000001";
const cursor = "70000000-0000-4000-8000-0000000000c1";
const accountId = "70000000-0000-4000-8000-0000000000a1";

function query(search: string): PaymentsQuery {
  return parsePaymentsSearchParams(new URLSearchParams(search));
}

describe("payment filters live in the address", () => {
  it("round-trips every filter through the address", () => {
    const chosen: PaymentsQuery = {
      states: ["unknown", "failed"],
      productId,
      from: "2026-10-01",
      to: "2026-10-20",
      cursor,
    };
    const search = serializePaymentsQuery(chosen);

    expect(search).toBe(
      `state=unknown&state=failed&product=${productId}&from=2026-10-01&to=2026-10-20&cursor=${cursor}`,
    );
    expect(query(search)).toEqual(chosen);
    expect(salesPaymentsQueryHref(chosen)).toBe(
      `/authoring/sales/payments?${search}`,
    );
    expect(salesPaymentsQueryHref(emptyPaymentsQuery)).toBe(
      "/authoring/sales/payments",
    );
  });

  it("keeps states in one canonical order without repeats", () => {
    expect(query("state=failed&state=confirmed&state=failed").states).toEqual([
      "confirmed",
      "failed",
    ]);
  });

  it("drops values outside the contract instead of failing the page", () => {
    expect(
      query(
        "state=paid&product=not-a-uuid&from=2026-13-40&to=yesterday&cursor=1",
      ),
    ).toEqual(emptyPaymentsQuery);
  });

  it("keeps the start of a period whose end comes first", () => {
    expect(query("from=2026-10-20&to=2026-10-01")).toEqual({
      states: [],
      from: "2026-10-20",
    });
  });

  it("returns to the start of the list on any filter change", () => {
    const paged: PaymentsQuery = { states: ["failed"], cursor };

    expect(
      withPaymentsFilter(paged, { key: "productId", value: productId }),
    ).toEqual({ states: ["failed"], productId });
    expect(
      withPaymentsFilter(paged, { key: "states", value: ["unknown", "sent"] }),
    ).toEqual({ states: ["sent", "unknown"] });
    expect(
      withPaymentsFilter(
        { states: [], from: "2026-10-01", to: "2026-10-02", cursor },
        { key: "period", value: undefined },
      ),
    ).toEqual({ states: [] });
    expect(
      withPaymentsFilter(paged, { key: "from", value: "2026-10-01" }),
    ).toEqual({ states: ["failed"], from: "2026-10-01" });
    expect(withPaymentsCursor({ states: [] }, cursor)).toEqual({
      states: [],
      cursor,
    });
  });

  it("names the period in Moscow days", () => {
    expect(paymentsPeriodLabel({ states: [], from: "2026-10-01" })).toBe(
      "С 1 окт. 2026",
    );
    expect(
      paymentsPeriodLabel({ states: [], from: "2026-10-01", to: "2026-10-20" }),
    ).toBe("С 1 окт. 2026 по 20 окт. 2026");
    expect(paymentsPeriodLabel({ states: [], to: "2026-10-20" })).toBe(
      "По 20 окт. 2026",
    );
    expect(paymentsPeriodLabel(emptyPaymentsQuery)).toBeUndefined();
  });
});

describe("payments of one person (#1717)", () => {
  it("keeps the person in the address and sends it to payments.list", () => {
    const chosen: PaymentsQuery = { states: ["confirmed"], accountId };
    expect(serializePaymentsQuery(chosen)).toBe(
      `state=confirmed&person=${accountId}`,
    );
    expect(query(`state=confirmed&person=${accountId}`)).toEqual(chosen);
    expect(query("person=me")).toEqual(emptyPaymentsQuery);
    expect(hasPaymentsFilters({ states: [], accountId })).toBe(true);
    expect(paymentsListRequest({ states: [], accountId })).toEqual({
      limit: 50,
      accountId,
    });
  });

  it("opens the payments list of a person from their card", () => {
    expect(personPaymentsHref(accountId)).toBe(
      `/authoring/sales/payments?person=${accountId}`,
    );
  });

  it("names the person in a chip whose removal keeps the other filters", () => {
    const chosen: PaymentsQuery = { states: ["failed"], accountId, cursor };
    expect(
      paymentsFilterChips(chosen, { kind: "pending" }, "Анна Петрова").at(-1),
    ).toEqual({
      id: "person",
      label: "Покупатель: Анна Петрова",
      next: { states: ["failed"] },
    });
    expect(
      paymentsFilterChips(chosen, { kind: "pending" }, null).at(-1)?.label,
    ).toBe("Покупатель: выбранный человек");
    expect(
      withPaymentsFilter(chosen, { key: "accountId", value: undefined }),
    ).toEqual({ states: ["failed"] });
  });
});

describe("payments with events for the owner's review (#1928)", () => {
  it("keeps events=review in the address and sends it to payments.list", () => {
    const chosen: PaymentsQuery = { states: ["failed"], events: "review" };
    expect(serializePaymentsQuery(chosen)).toBe("state=failed&events=review");
    expect(query("state=failed&events=review")).toEqual(chosen);
    expect(query("events=all")).toEqual(emptyPaymentsQuery);
    expect(hasPaymentsFilters({ states: [], events: "review" })).toBe(true);
    expect(paymentsListRequest(chosen)).toEqual({
      limit: 50,
      states: ["failed"],
      events: "review",
    });
    const request = paymentsListRequest(chosen);
    expect(
      parsePaymentsListRequest(
        new URLSearchParams(serializePaymentsListRequest(request)),
      ),
    ).toEqual(request);
    expect(
      parsePaymentsListRequest(new URLSearchParams("events=all")),
    ).toBeNull();
  });

  it("names the filter in a chip whose removal keeps the other filters", () => {
    const chosen: PaymentsQuery = {
      states: [],
      productId,
      events: "review",
      cursor,
    };
    expect(
      paymentsFilterChips(chosen, { kind: "pending" }).find(
        (chip) => chip.id === "events",
      ),
    ).toEqual({
      id: "events",
      label: "Есть события для проверки",
      next: { states: [], productId },
    });
    expect(
      withPaymentsFilter(
        { states: [], cursor },
        { key: "events", value: "review" },
      ),
    ).toEqual({ states: [], events: "review" });
  });
});

describe("authoring addresses encode their identifiers (#1717)", () => {
  it("encodes the account and the purchase reference as one path segment", () => {
    expect(authoringPersonHref("a/b?c")).toBe("/authoring/people/a%2Fb%3Fc");
    expect(authoringPaymentHref("a/b?c")).toBe(
      "/authoring/sales/payments/a%2Fb%3Fc",
    );
    expect(authoringPersonHref(accountId)).toBe(
      `/authoring/people/${accountId}`,
    );
  });
});

describe("the list request turns Moscow days into the half-open range [from, to)", () => {
  it("starts at Moscow midnight and ends at the next Moscow midnight", () => {
    expect(
      paymentsListRequest({
        states: ["confirmed"],
        productId,
        from: "2026-10-01",
        to: "2026-10-20",
        accountId,
        cursor,
      }),
    ).toEqual({
      limit: 50,
      accountId,
      states: ["confirmed"],
      productId,
      from: "2026-09-30T21:00:00.000Z",
      to: "2026-10-20T21:00:00.000Z",
      cursor,
    });
    expect(paymentsListRequest(emptyPaymentsQuery)).toEqual({ limit: 50 });
  });

  it("crosses the BFF address unchanged", () => {
    const request = paymentsListRequest({
      states: ["unknown", "failed"],
      from: "2026-10-01",
      productId,
      accountId,
    });
    expect(
      parsePaymentsListRequest(
        new URLSearchParams(serializePaymentsListRequest(request)),
      ),
    ).toEqual(request);
  });

  it("refuses a BFF address outside the schema", () => {
    for (const search of [
      "limit=500",
      "state=paid",
      "productId=abc",
      "from=2026-10-01",
      "cursor=1",
      "accountId=me",
    ])
      expect(parsePaymentsListRequest(new URLSearchParams(search))).toBeNull();
  });
});

describe("payment presentation", () => {
  const payment: PaymentView = ownerPayment(0, { accountId });

  it("shows an unknown bank state as needing reconciliation, never as fine", () => {
    const unknown = adminStates[paymentStateBadge("unknown")];
    expect(unknown).toEqual({
      label: "Неизвестно, нужна сверка",
      tone: "attention",
    });
    expect(paymentStateLabels.unknown).toBe(unknown.label);
    expect(adminStates[paymentStateBadge("confirmed")].tone).toBe("positive");
    expect(adminStates[paymentStateBadge("failed")].tone).toBe("critical");
  });

  it("takes every state label from the shared dictionary", () => {
    for (const state of paymentStates)
      expect(adminStates[paymentStateBadge(state)].label).toBe(
        paymentStateLabels[state],
      );
  });

  it("keeps access readiness apart from the bank state", () => {
    expect(adminStates[paymentAccessBadge("review_required")]).toEqual({
      label: "Доступ ждёт проверки",
      tone: "attention",
    });
    expect(adminStates[paymentAccessBadge("ready")].tone).toBe("positive");
  });

  it("names the product from the paid snapshot, the offer for historical purchases", () => {
    expect(paymentProductName(payment)).toBe(
      "AI Engineering: от промпта до продакшна",
    );
    const { product: _product, ...historical } = payment.snapshot;
    expect(
      paymentProductName({
        ...payment,
        snapshot: {
          ...historical,
          offer: { ...historical.offer, name: "Тариф 2024" },
        },
      }),
    ).toBe("Тариф 2024");
  });

  it("does not guess unresolved refund amounts", () => {
    expect(refundAmountText(null)).toBe("Уточняется в банке");
    expect(refundAmountText(150_000)).toBe("1 500 ₽");
  });

  it("names bank events and keeps unknown ones visible", () => {
    expect(paymentEventLabel("payment_confirmed")).toBe(
      "Банк подтвердил оплату",
    );
    expect(paymentEventLabel(`partial_refund_observed:${"a".repeat(64)}`)).toBe(
      "Банк сообщил о частичном возврате, сумму нужно проверить",
    );
    expect(paymentEventLabel("bank_cancel_requested")).toBe(
      "Попытка снята, сверка закроет её форму оплаты в банке",
    );
    expect(paymentEventLabel("replaced_by_new_price")).toBe(
      "Попытка заменена покупкой по другой цене",
    );
    expect(paymentEventLabel("bank_cancel_confirmed")).toBe(
      "Банк закрыл форму оплаты снятой попытки",
    );
    expect(paymentEventLabel("bank_cancel_returned_payment")).toBe(
      "Покупатель успел оплатить снятую попытку, отмена вернула деньги",
    );
    expect(paymentEventLabel("bank_status_unrecognized")).toBe(
      "Банк прислал статус не из справочника, покупку проверит сверка",
    );
    expect(paymentEventLabel("bank_order_empty")).toBe(
      "Банк не нашёл платёж по заказу, сверка проверит снова",
    );
    expect(paymentEventLabel("bank_payment_absent")).toBe(
      "Платежа в банке нет, покупка закрыта, деньги не списаны",
    );
    expect(paymentEventLabel("new_bank_event")).toBe("Событие new_bank_event");
  });

  it("links a row to its payment page", () => {
    expect(authoringPaymentHref(payment.purchaseRef)).toBe(
      `/authoring/sales/payments/${payment.purchaseRef}`,
    );
  });
});

describe("sales navigation (#1718)", () => {
  const sales = authoringNavigation.find((group) => group.id === "sales");

  it("leads every sales item to its own address under /authoring/sales", () => {
    expect(
      sales?.items.map((item) => [item.id, item.href, item.paths]),
    ).toEqual([
      ["payments", "/authoring/sales/payments", ["/authoring/sales/payments"]],
      ["payment-links", "/authoring/sales/links", ["/authoring/sales/links"]],
      [
        "discounts",
        "/authoring/sales/discounts",
        ["/authoring/sales/discounts"],
      ],
      ["sales-funnel", "/authoring/sales/funnel", ["/authoring/sales/funnel"]],
    ]);
  });

  it("opens payments from the phone «Продажи» tab", () => {
    const tab = authoringMobileTabs.find((item) => item.group === "sales");
    expect(tab?.item).toMatchObject({
      label: "Продажи",
      href: "/authoring/sales/payments",
    });
  });

  it("keeps «Платежи» current on the list and on a payment", () => {
    expect(authoringLocation("/authoring/sales/payments")).toMatchObject({
      item: { id: "payments" },
      group: { id: "sales" },
      atSectionRoot: true,
    });
    expect(
      authoringLocation(
        "/authoring/sales/payments/70000000-0000-4000-8000-0000000000b1",
      ),
    ).toMatchObject({
      item: { id: "payments" },
      group: { id: "sales" },
      atSectionRoot: false,
    });
    expect(authoringLocation("/authoring/billing").item).toBeUndefined();
  });
});
