// @ts-check
import { applyJournaled } from "./journal.mjs";

/** Recover only a stored operation. The lookup never dispatches the old mutation.
 * Historical journals do not bind the original actor. Even a coded 404 can mean that another
 * manager is logged in, so no failed lookup proves the original mutation was absent.
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
  return applyJournaled(context, operation, async (original, key) => {
    try {
      return await request(path, original.body, key);
    } catch (error) {
      // Keep the exact UNKNOWN request pending. Only a successful authorized receipt can resolve it.
      if (error instanceof Error && "status" in error)
        throw new Error(
          "Historical receipt lookup unavailable; recovery required",
          { cause: error },
        );
      throw error;
    }
  });
}
