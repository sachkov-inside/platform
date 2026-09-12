import { contactsV1 } from "./editions/contacts-v1.js";
import { cookiesV1 } from "./editions/cookies-v1.js";
import { privacyV2 } from "./editions/privacy-v2.js";
import { purchaseV1 } from "./editions/purchase-v1.js";
import { recurringConsentV1 } from "./editions/recurring-consent-v1.js";
import { subscriptionV1 } from "./editions/subscription-v1.js";
import { termsV1 } from "./editions/terms-v1.js";
import { tributeV1 } from "./editions/tribute-v1.js";
import {
  legalDocumentKeys,
  legalDocumentPath,
  type LegalDocumentKey,
  type LegalEdition,
} from "./document.js";

/**
 * Every edition the site publishes, superseded ones included: a stored consent must stay readable
 * at its own address after a newer version takes effect.
 */
export const legalEditions: readonly LegalEdition[] = [
  contactsV1,
  termsV1,
  privacyV2,
  cookiesV1,
  purchaseV1,
  subscriptionV1,
  recurringConsentV1,
  tributeV1,
];

/**
 * The edition in force for a document. Editions are published when they take effect, so the
 * highest version is the current one; publishing a future edition ahead of its date would need
 * its own owner decision and a clock this module deliberately does not have.
 */
export function currentLegalEdition(key: LegalDocumentKey): LegalEdition {
  const editions = legalEditions.filter((edition) => edition.key === key);
  const [current] = [...editions].sort((left, right) =>
    right.version - left.version,
  );
  if (current === undefined)
    throw new Error(`Legal document without an edition: ${key}`);
  return current;
}

/** Editions in force, in the order the legal index shows them. */
export function currentLegalEditions(): readonly LegalEdition[] {
  return legalDocumentKeys.map((key) => currentLegalEdition(key));
}

export function findLegalEdition(
  key: LegalDocumentKey,
  version: number,
): LegalEdition | undefined {
  return legalEditions.find(
    (edition) => edition.key === key && edition.version === version,
  );
}

/** Superseded editions of a document, newest first; empty while only one edition exists. */
export function supersededLegalEditions(
  key: LegalDocumentKey,
): readonly LegalEdition[] {
  const current = currentLegalEdition(key);
  return legalEditions
    .filter(
      (edition) => edition.key === key && edition.version !== current.version,
    )
    .sort((left, right) => right.version - left.version);
}

export const consentKinds = [
  "terms",
  "recurring",
  "personal_data",
  "marketing",
] as const;
export type ConsentKind = (typeof consentKinds)[number];

export const paymentModes = ["one_time", "subscription"] as const;
export type PaymentMode = (typeof paymentModes)[number];

/**
 * A document the buyer accepts before payment. Reading the privacy policy is not a consent, so the
 * policy is linked next to the form instead of appearing here as a checkbox.
 */
export interface ConsentDocument {
  readonly kind: ConsentKind;
  /** Payment modes this document applies to: an offer belongs to the sale it governs. */
  readonly appliesTo: readonly PaymentMode[];
  readonly documentId: string;
  readonly version: string;
  readonly digest: string;
  /** Absolute address of the accepted edition, stored with the consent as shown. */
  readonly url: string;
  readonly text: string;
}

interface ConsentDefinition {
  readonly kind: ConsentKind;
  readonly appliesTo: readonly PaymentMode[];
  readonly edition: LegalEdition;
}

/**
 * A one-time guide purchase accepts its own offer and no recurring consent; a subscription accepts
 * the subscription offer and, separately, the consent to its periodic payments.
 */
const consentDefinitions: readonly ConsentDefinition[] = [
  { kind: "terms", appliesTo: ["one_time"], edition: purchaseV1 },
  { kind: "terms", appliesTo: ["subscription"], edition: subscriptionV1 },
  { kind: "recurring", appliesTo: ["subscription"], edition: recurringConsentV1 },
];

/** A bare public origin: the catalogue appends a page path and never a second slash. */
const originPattern = /^https?:\/\/[^/?#\s]+$/u;

/** Consent catalogue with addresses resolved against the public site origin. */
export function consentDocuments(origin: string): readonly ConsentDocument[] {
  if (!originPattern.test(origin))
    throw new Error(
      `Legal consent catalogue needs a bare public origin, received: ${origin}`,
    );
  return consentDefinitions.map((definition) => ({
    kind: definition.kind,
    appliesTo: definition.appliesTo,
    documentId: definition.edition.key,
    version: String(definition.edition.version),
    digest: definition.edition.digest,
    url: `${origin}${legalDocumentPath(definition.edition.key)}`,
    text: definition.edition.text,
  }));
}
