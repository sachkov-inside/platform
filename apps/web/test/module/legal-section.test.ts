import { currentLegalEdition, currentLegalEditions } from "@inside/legal";
import { legalDocumentKeys } from "@inside/legal/document";
import { expect, it } from "vitest";

import { LEGAL_GROUP_ORDER, LEGAL_NAVIGATION, LEGAL_SELLER } from "@/entities/legal-document";
import { purchaseConsentPolicy, type LegalDocument } from "@/entities/subscription";
import { legalDocumentPath, legalEditionPath } from "@/shared/routing/public-page-path";

it("раздел показывает каждый действующий документ ровно один раз", () => {
  const listed = LEGAL_NAVIGATION.map((entry) => entry.key);

  expect([...listed].sort()).toEqual([...legalDocumentKeys].sort());
  expect(new Set(listed).size).toBe(listed.length);
  for (const entry of LEGAL_NAVIGATION) {
    expect(LEGAL_GROUP_ORDER).toContain(entry.group);
  }
});

it("адрес документа и адрес его редакции остаются внутренними маршрутами", () => {
  for (const edition of currentLegalEditions()) {
    expect(legalDocumentPath(edition.key)).toBe(`/legal/${edition.key}`);
    expect(legalEditionPath(edition.key, edition.version)).toBe(
      `/legal/${edition.key}/v${String(edition.version)}`,
    );
  }
});

it("краткие сведения продавца в футере взяты из документа о реквизитах", () => {
  const contacts = currentLegalEdition("contacts").text;

  expect(contacts).toContain("Сачков Кирилл Олегович");
  expect(contacts).toContain(LEGAL_SELLER.inn);
  expect(contacts).toContain(LEGAL_SELLER.ogrnip);
  expect(contacts).toContain(LEGAL_SELLER.email);
});

it("покупателю показывается оферта его покупки, а не обе сразу", () => {
  const documents: readonly LegalDocument[] = [
    {
      kind: "terms",
      appliesTo: ["one_time"],
      documentId: "purchase",
      version: "1",
      digest: "a".repeat(64),
      url: "https://inside.example.test/legal/purchase",
      text: "",
    },
    {
      kind: "terms",
      appliesTo: ["subscription"],
      documentId: "subscription",
      version: "1",
      digest: "b".repeat(64),
      url: "https://inside.example.test/legal/subscription",
      text: "",
    },
    {
      kind: "recurring",
      appliesTo: ["subscription"],
      documentId: "recurring-consent",
      version: "1",
      digest: "c".repeat(64),
      url: "https://inside.example.test/legal/recurring-consent",
      text: "",
    },
  ];

  const oneTime = purchaseConsentPolicy(documents, "one_time");
  const subscription = purchaseConsentPolicy(documents, "subscription");

  expect(oneTime.applicable.map((document) => document.documentId)).toEqual(["purchase"]);
  expect(oneTime.required).toEqual(["terms"]);
  expect(subscription.applicable.map((document) => document.documentId)).toEqual([
    "subscription",
    "recurring-consent",
  ]);
  expect(subscription.required).toEqual(["terms", "recurring"]);
});
