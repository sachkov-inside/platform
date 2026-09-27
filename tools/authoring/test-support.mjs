// @ts-check
// Shared by the authoring tests; it is not a test file itself.
import assert from "node:assert/strict";
import { z } from "zod";

/**
 * The item a test expects at a position; a missing item fails the test.
 *
 * @template T
 * @param {readonly T[]} items
 * @param {number} index
 * @returns {T}
 */
export function itemAt(items, index) {
  const item = items[index];
  assert.ok(item !== undefined, `Expected an item at position ${index}`);
  return item;
}

/**
 * The value a test expects under a key; a missing value fails the test.
 *
 * @template K, V
 * @param {ReadonlyMap<K, V>} map
 * @param {K} key
 * @returns {V}
 */
export function valueAt(map, key) {
  const value = map.get(key);
  assert.ok(value !== undefined, `Expected a value for ${String(key)}`);
  return value;
}

/** Test doubles read the reservation a sync sends before any Material exists. */
export const reservationBodySchema = z
  .object({
    source: z.object({ id: z.string(), path: z.string() }).passthrough(),
  })
  .passthrough();
