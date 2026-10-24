// @ts-check
import { applyJournaled } from "./journal.mjs";

/** Recover only a stored operation. The lookup never dispatches the old mutation.
 * A proven absent receipt resolves an uncommitted old request; an unavailable route does not.
 * @template {{ path: string; body?: unknown }} R
 * @param {import('./journal.mjs').JournalContext} context
 * @param {R} operation
 * @param {import('./local-boundaries.mjs').LocalRequest} request
 * @param {'/authoring/history/material-receipts' | '/authoring/history/practice-receipts'} path
 */
export async function recoverHistoricalReceipt(
  context,
  operation,
  request,
  path,
) {
  try {
    return await applyJournaled(context, operation, async (original, key) => {
      try {
        return await request(path, original.body, key);
      } catch (error) {
        if (
          error instanceof Error &&
          "status" in error &&
          error.status === 404 &&
          !isAbsentReceipt(error)
        )
          throw new Error(
            "Historical receipt lookup unavailable; recovery required",
            { cause: error },
          );
        throw error;
      }
    });
  } catch (error) {
    if (isAbsentReceipt(error)) return undefined;
    throw error;
  }
}

/** @param {unknown} error */
function isAbsentReceipt(error) {
  return (
    error instanceof Error &&
    "status" in error &&
    error.status === 404 &&
    "body" in error &&
    typeof error.body === "object" &&
    error.body !== null &&
    "code" in error.body &&
    error.body.code === "historical_receipt_not_found"
  );
}
