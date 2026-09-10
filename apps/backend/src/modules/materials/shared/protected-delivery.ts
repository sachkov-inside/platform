import type { ObjectStorage, StoredObject } from "../../../infrastructure/object-storage/index.js";

/**
 * Delivery policy shared by every protected download this module serves.
 * Both Material assets and Guide Artifacts hand the reader either public
 * immutable bytes or one short-lived signed address, under the same rules.
 */

/** Names the downloaded file without letting it steer the response headers. */
export function attachmentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/gu,
    (character) => `%${character.codePointAt(0)?.toString(16).toUpperCase() ?? ""}`,
  );
  return `attachment; filename="download"; filename*=UTF-8''${encoded}`;
}

/**
 * A signed address never outlives the access that justified it. Returns `null`
 * when the remaining access is already too short to sign for.
 */
export function signedDeliveryTtlSeconds(
  configuredTtlSeconds: number,
  validUntil: string | null | undefined,
): number | null {
  if (validUntil === undefined || validUntil === null) return configuredTtlSeconds;
  const remainingWholeSeconds = Math.floor(
    (Date.parse(validUntil) - Date.now()) / 1_000,
  );
  const bounded = Math.min(configuredTtlSeconds, remainingWholeSeconds - 1);
  return bounded >= 1 ? bounded : null;
}

export type PublicObjectRead =
  | Readonly<{ kind: "bytes"; object: StoredObject }>
  | Readonly<{ kind: "mismatch" }>
  | Readonly<{ kind: "unavailable" }>;

/**
 * Reads one public immutable object and confirms it still matches the size and
 * content type the owning record promises, so a replaced or half-written
 * object is reported instead of served.
 */
export async function readPublicObject(
  objectStorage: Pick<ObjectStorage, "read">,
  expected: Readonly<{ contentType: string; key: string | null; size: number }>,
): Promise<PublicObjectRead> {
  if (expected.key === null) return { kind: "mismatch" };
  let stored: StoredObject | null;
  try {
    stored = await objectStorage.read("public", expected.key);
  } catch {
    return { kind: "unavailable" };
  }
  return stored === null ||
    stored.contentLength !== expected.size ||
    stored.contentType !== expected.contentType
    ? { kind: "unavailable" }
    : { kind: "bytes", object: stored };
}
