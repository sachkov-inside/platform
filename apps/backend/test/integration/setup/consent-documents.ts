import { createHash } from "node:crypto";

import type { PaymentMode } from "@inside/legal";

import type { LegalDocument } from "../../../src/modules/accounts/facets/billing-contact/billing-contact.contract.js";

/** Recurring payments exist only in a subscription; other kinds apply to both sales. */
const defaultModes: Readonly<
  Record<LegalDocument["kind"], readonly PaymentMode[]>
> = {
  terms: ["one_time", "subscription"],
  recurring: ["subscription"],
  personal_data: ["one_time", "subscription"],
  marketing: ["one_time", "subscription"],
};

/**
 * A stand-in consent document for billing scenarios: it carries a real digest so the facet accepts
 * it, and text that can never be mistaken for a published legal edition.
 */
export function syntheticConsentDocument(
  kind: LegalDocument["kind"],
  options: {
    readonly version?: string;
    readonly appliesTo?: readonly PaymentMode[];
  } = {},
): LegalDocument {
  const version = options.version ?? "test-v1";
  const text = `Synthetic ${kind} ${version}, not legal terms`;
  return {
    kind,
    appliesTo: options.appliesTo ?? defaultModes[kind],
    documentId: kind,
    version,
    text,
    digest: createHash("sha256").update(text).digest("hex"),
    url: `https://example.test/legal/${kind}/${version}`,
  };
}

/** The catalogue a billing scenario needs: one offer per mode plus the recurring consent. */
export const syntheticConsentDocuments: readonly LegalDocument[] = [
  syntheticConsentDocument("terms"),
  syntheticConsentDocument("recurring"),
];

/** Where a scenario takes the renewal terms that its subscription button shows. */
export interface RenewalSource {
  readonly snapshot: {
    readonly renewalPriceKopecks: number;
    readonly paymentOption: { readonly months: number };
  };
  /** Known only for a resumed subscription; a new one starts its period on bank confirmation. */
  readonly nextChargeAt?: Date;
}

/**
 * A payment consent command as the pressed button sends it: the screen, the button label and, where
 * recurring payments are accepted, the renewal terms shown next to that button.
 */
export function pressedPaymentButton<
  Command extends { readonly documents: readonly { readonly kind: string }[] },
>(
  command: Command,
  renewal?: RenewalSource,
  screen: "checkout" | "subscription-resume" = "checkout",
) {
  const recurring = command.documents.some(
    (document) => document.kind === "recurring",
  );
  if (recurring && renewal === undefined)
    throw new Error(
      "A recurring consent shows renewal terms next to its button",
    );
  return {
    ...command,
    screen,
    buttonLabel:
      screen === "checkout" ? "Оплатить" : "Возобновить автопродление",
    ...(recurring && renewal !== undefined
      ? {
          shownTerms: {
            amountKopecks: renewal.snapshot.renewalPriceKopecks,
            periodMonths: renewal.snapshot.paymentOption.months,
            nextChargeOn: (
              renewal.nextChargeAt ?? new Date("2030-01-01T00:00:00Z")
            )
              .toISOString()
              .slice(0, 10),
          },
        }
      : {}),
  };
}
