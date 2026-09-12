import { expect, it } from "vitest";

import { acceptedPurchaseDocuments } from "@/features/billing-checkout";
import type { LegalDocument } from "@/entities/subscription";

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

it("разовая покупка принимает свою оферту, а не обе сразу", () => {
  const accepted = acceptedPurchaseDocuments(documents, "one_time", ["terms"]);

  expect(accepted.map((document) => document.documentId)).toEqual(["purchase"]);
});

it("подписка принимает свою оферту и согласие на списания", () => {
  const accepted = acceptedPurchaseDocuments(documents, "subscription", ["terms", "recurring"]);

  expect(accepted.map((document) => document.documentId)).toEqual([
    "subscription",
    "recurring-consent",
  ]);
});

it("в команду не уходит два документа одного вида ни при каком режиме", () => {
  // Приложение отвергает повторяющиеся виды целиком, поэтому покупатель увидел бы отказ вместо
  // оплаты. Эта проверка падает раньше него.
  for (const mode of ["one_time", "subscription"] as const) {
    const accepted = acceptedPurchaseDocuments(documents, mode, ["terms", "recurring"]);
    const kinds = accepted.map((document) => document.kind);

    expect(new Set(kinds).size).toBe(kinds.length);
  }
});
