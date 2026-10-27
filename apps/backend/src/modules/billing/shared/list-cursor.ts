import { z } from "zod";

import { idSchema } from "../domain/pricing.js";

/** The filter a cursor was issued for: every field of the list filter, absent ones as null. */
export type ListCursorScope = Readonly<Record<string, string | boolean | null>>;

/** The last row of a page in a list ordered by time, then id, both descending. */
export interface ListCursorPosition {
  readonly at: Date;
  readonly id: string;
}

/** An opaque continuation of an owner list; only `encodeListCursor` issues one. */
export const listCursorSchema = z.base64url().min(1).max(1024);

const cursorSchema = z.strictObject({
  version: z.literal(1),
  scope: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])),
  after: z.tuple([z.iso.datetime(), idSchema]),
});

/**
 * The cursor carries its whole filter: a page continues only the list it came from, whatever
 * happened to the row it stopped at, and a cursor of another filter is refused.
 */
export function encodeListCursor(
  scope: ListCursorScope,
  position: ListCursorPosition,
): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      scope,
      after: [position.at.toISOString(), position.id],
    }),
  ).toString("base64url");
}

/** The position of a cursor issued for exactly `scope`, otherwise null. */
export function decodeListCursor(
  value: string,
  scope: ListCursorScope,
): ListCursorPosition | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    // Malformed caller data is invalid input, not a failure.
    return null;
  }
  const cursor = cursorSchema.safeParse(decoded);
  if (!cursor.success) return null;
  const keys = Object.keys(scope);
  const issued = cursor.data.scope;
  if (
    Object.keys(issued).length !== keys.length ||
    keys.some((key) => issued[key] !== scope[key])
  )
    return null;
  const [at, id] = cursor.data.after;
  return { at: new Date(at), id };
}
