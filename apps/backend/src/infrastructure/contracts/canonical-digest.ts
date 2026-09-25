import { createHash } from "node:crypto";

/**
 * Sorted object keys, original array order and no incidental whitespace.
 * The billing integration protocols fingerprint the exact schema-valid wire
 * payload, so both sides must agree on this one form. Notification transport
 * keeps its own prefixed envelope digest and its own UUID normalisation.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contractDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * The replay fingerprint of an idempotent command envelope. Keys follow `localeCompare` and absent
 * optional fields drop out, so the same payload in any key order matches and a changed one
 * conflicts. Materials, Billing and Tribute events store these digests beside their receipts, so
 * the form never changes in place: a new form needs a new envelope version. Workshop publication
 * digests follow the Inside Content protocol and keep their own form.
 */
export function commandDigest(envelope: unknown): string {
  return createHash("sha256").update(JSON.stringify(commandForm(envelope))).digest("hex");
}

function commandForm(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(commandForm);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, commandForm(child)]),
  );
}
