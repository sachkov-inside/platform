import { expect, it } from "vitest";

import { acceptedDocumentItems } from "@/features/accepted-documents";

it("names each accepted document with its date, button and permanent edition address", () => {
  const items = acceptedDocumentItems([
    {
      acceptanceRef: "3f0c8a3e-1c7b-4c1e-9a55-0a4f1e2b7c11",
      documentId: "recurring-consent",
      version: "1",
      url: "https://inside.example.test/legal/recurring-consent/v1",
      acceptedAt: "2026-10-01T09:04:00.000Z",
      screen: "checkout",
      buttonLabel: "Оформить подписку и оплатить 990 ₽",
      shownTerms: { amountKopecks: 99_000, nextChargeOn: "2026-11-01", periodMonths: 1 },
    },
    {
      acceptanceRef: "4a1d9b4f-2d8c-4d2f-8b66-1b5f2f3c8d22",
      documentId: "terms",
      version: "1",
      url: "https://inside.example.test/legal/terms/v1",
      acceptedAt: "2026-09-15T09:04:00.000Z",
      screen: null,
      buttonLabel: null,
      shownTerms: null,
    },
  ]);
  expect(items[0]).toMatchObject({
    title: "Согласие на автопродление",
    buttonLabel: "Оформить подписку и оплатить 990 ₽",
    edition: "редакция 1",
    href: "/legal/recurring-consent/v1",
  });
  expect(items[0]?.acceptedAt).toMatch(/1 октября 2026/u);
  expect(items[0]?.shownTerms).toMatch(/^следующее списание 990\s₽ — 1 ноября 2026 г\./u);
  expect(items[1]).toMatchObject({ title: "Условия использования", buttonLabel: null, shownTerms: null });
});
