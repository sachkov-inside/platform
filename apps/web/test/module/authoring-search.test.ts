import { describe, expect, it } from "vitest";

import {
  searchGroupEntries,
  searchGroupPresentation,
  searchResponseSchema,
} from "@/features/authoring-search/model/authoring-search";

function plain(text: string | null): string | null {
  return text === null ? null : text.replace(/[  ]/gu, " ");
}

const payment = {
  amountKopecks: 126000,
  createdAt: "2030-01-31T22:30:00.000Z",
  productName: "Архитектура приложения",
  purchaseRef: "5c3a6f0e-2b1d-4c8e-9f7a-1d2e3f4a5b6c",
  state: "confirmed",
};

describe("authoring search Payments group (#1718)", () => {
  it("reads the Payments group the server answers and its unavailable state", () => {
    expect(
      searchResponseSchema.parse({
        groups: [
          { kind: "payments", state: "ready", items: [payment] },
          { kind: "payments", state: "unavailable" },
        ],
      }).groups,
    ).toHaveLength(2);
  });

  it("rejects a payment hit that carries a buyer or contact field", () => {
    for (const extra of [
      { email: "order@example.test" },
      { accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    ])
      expect(
        searchResponseSchema.safeParse({
          groups: [
            {
              kind: "payments",
              state: "ready",
              items: [{ ...payment, ...extra }],
            },
          ],
        }).success,
      ).toBe(false);
  });

  it("titles a hit by its Product and opens the payment page, with the sum and the Moscow date below", () => {
    expect(searchGroupPresentation.payments.heading).toBe("Платежи");
    const [entry, ...rest] = searchGroupEntries({
      kind: "payments",
      state: "ready",
      items: [{ ...payment, state: "confirmed" }],
    });
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      id: `payments-${payment.purchaseRef}`,
      href: `/authoring/sales/payments/${payment.purchaseRef}`,
      title: "Архитектура приложения",
    });
    // 22:30 UTC on 31 January is already 1 February in Moscow.
    expect(plain(entry?.caption ?? null)).toBe("1 260 ₽ · 1 февр. 2030");
  });

  it("shows nothing for an unavailable Payments group", () => {
    expect(
      searchGroupEntries({ kind: "payments", state: "unavailable" }),
    ).toEqual([]);
  });
});
