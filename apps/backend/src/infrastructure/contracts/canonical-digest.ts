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
