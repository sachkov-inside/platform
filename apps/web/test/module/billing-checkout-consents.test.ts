import { expect, it } from "vitest";

import { acceptedPurchaseDocuments } from "@/features/billing-checkout/model/checkout";
import type { BillingQuote, LegalDocument, PaymentMode } from "@/entities/subscription";

/** Каталог, в котором две оферты одного вида: именно он ломал покупку до этой правки. */
const documents: readonly LegalDocument[] = [
  {
    kind: "terms", appliesTo: ["one_time"], documentId: "purchase", version: "1",
    digest: "a".repeat(64), url: "https://inside.example.test/legal/purchase", text: "",
  },
  {
    kind: "terms", appliesTo: ["subscription"], documentId: "subscription", version: "1",
    digest: "b".repeat(64), url: "https://inside.example.test/legal/subscription", text: "",
  },
  {
    kind: "recurring", appliesTo: ["subscription"], documentId: "recurring-consent", version: "1",
    digest: "c".repeat(64), url: "https://inside.example.test/legal/recurring-consent", text: "",
  },
];

/** Расчёт несёт режим покупки: правило берёт его оттуда же, откуда берут панель и приложение. */
const quoteFor = (mode: PaymentMode): BillingQuote =>
  ({ snapshot: { paymentOption: { mode } } } as unknown as BillingQuote);

it("разовая покупка принимает свою оферту, а не обе сразу", () => {
  const accepted = acceptedPurchaseDocuments(documents, quoteFor("one_time"), ["terms"]);

  expect(accepted.map((document) => document.documentId)).toEqual(["purchase"]);
});

it("в команду не уходит два документа одного вида ни при каком режиме", () => {
  // Приложение отвергает повторяющиеся виды целиком, поэтому покупатель увидел бы отказ вместо
  // оплаты. Эта проверка падает раньше него.
  const subscription = acceptedPurchaseDocuments(documents, quoteFor("subscription"), ["terms", "recurring"]);
  expect(subscription.map((document) => document.documentId)).toEqual([
    "subscription",
    "recurring-consent",
  ]);

  for (const mode of ["one_time", "subscription"] as const) {
    const kinds = acceptedPurchaseDocuments(documents, quoteFor(mode), ["terms", "recurring"])
      .map((document) => document.kind);

    expect(new Set(kinds).size).toBe(kinds.length);
  }
});
