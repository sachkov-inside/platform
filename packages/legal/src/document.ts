/**
 * One published legal edition. A published edition never changes: correcting a text means adding
 * the next version, because a buyer's stored consent points at this exact version and digest.
 */

export const legalDocumentKeys = [
  "contacts",
  "terms",
  "privacy",
  "cookies",
  "purchase",
  "subscription",
  "recurring-consent",
  "tribute",
] as const;

export type LegalDocumentKey = (typeof legalDocumentKeys)[number];

export interface LegalEdition {
  readonly key: LegalDocumentKey;
  readonly version: number;
  /** Calendar day the edition takes effect, as `YYYY-MM-DD`. */
  readonly effectiveFrom: string;
  readonly title: string;
  /** One sentence for the legal index and the page preview. */
  readonly summary: string;
  /** The exact accepted text in the Markdown subset `parseLegalText` accepts. */
  readonly text: string;
  /** SHA-256 of `text` in lowercase hex, stored with the edition and checked by its test. */
  readonly digest: string;
}

/** Address of the edition in force. */
export function legalDocumentPath(key: LegalDocumentKey): string {
  return `/legal/${key}`;
}

/** Stable address of one edition, which keeps a superseded text readable. */
export function legalEditionPath(
  key: LegalDocumentKey,
  version: number,
): string {
  return `/legal/${key}/v${String(version)}`;
}

/** Parses the version segment of an edition address; rejects anything but `v<number>`. */
export function legalEditionVersion(segment: string): number | undefined {
  const match = /^v(?<version>[1-9][0-9]{0,2})$/u.exec(segment);
  const version = match?.groups?.version;
  return version === undefined ? undefined : Number(version);
}
