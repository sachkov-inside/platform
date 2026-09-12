import { consentDocuments, paymentModes } from "@inside/legal";
import { describe, expect, it } from "vitest";

import { paymentModeSchema } from "../src/modules/billing/domain/pricing.js";
import {
  legalDocumentSchema,
  type LegalDocument,
} from "../src/modules/accounts/facets/billing-contact/billing-contact.contract.js";

const origin = "https://inside.example.test";

describe("published consent catalogue", () => {
  it("names the same payment modes as billing pricing", () => {
    expect([...paymentModes].toSorted()).toEqual(
      [...paymentModeSchema.options].toSorted(),
    );
  });

  it("passes the contact contract for every published document", () => {
    for (const document of consentDocuments(origin))
      expect(() => legalDocumentSchema.parse(document)).not.toThrow();
  });

  it("keeps one document per kind inside a payment mode", () => {
    for (const mode of paymentModes) {
      const kinds = consentDocuments(origin)
        .filter((document) => document.appliesTo.includes(mode))
        .map((document) => document.kind);
      expect(kinds.length).toBeGreaterThan(0);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });

  it("asks for an offer and recurring consent, never for the privacy policy", () => {
    const kinds = new Set(
      consentDocuments(origin).map((document): LegalDocument["kind"] => document.kind),
    );
    expect([...kinds].toSorted()).toEqual(["recurring", "terms"]);
  });

  it("addresses documents on the configured public origin", () => {
    for (const document of consentDocuments(origin))
      expect(document.url.startsWith(`${origin}/legal/`)).toBe(true);
  });

  it("refuses an origin that would build a wrong address", () => {
    expect(() => consentDocuments("https://inside.example.test/")).toThrow(
      "bare public origin",
    );
    expect(() => consentDocuments("inside.example.test")).toThrow(
      "bare public origin",
    );
  });
});
