// @ts-check
import { z } from "zod";
import { canonical, checksum, sourcePracticeSchema } from "./package.mjs";
import { recoverHistoricalReceipt } from "./historical-receipts.mjs";
import {
  isJournalOperation,
  practiceReceiptSchema,
} from "./local-boundaries.mjs";

const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const applyBody = sourcePracticeSchema
  .extend({
    materialId: z.uuid(),
    expectedContentVersion: version,
    expectedPracticeVersion: version.nullable(),
  })
  .strict();
const operationSchema = z
  .object({
    path: z.literal("/authoring/import/practices/apply"),
    body: applyBody,
  })
  .strict();
const storedSchema = z
  .object({ practiceVersion: version, digest: z.hash("sha256") })
  .strict();

/** @param {z.infer<typeof applyBody>} body */
function digest(body) {
  const { expectedPracticeVersion: _cas, ...state } = body;
  return checksum(canonical(state));
}

/** Recover an uncertain request before reading current versions; never invent another key. An
 * unfinished publication of a practice resumes only when this run approves its lesson (#805).
 * @param {import('./journal.mjs').JournalContext} context
 * @param {import('./local-boundaries.mjs').LocalRequest} request
 * @param {(materialSourceId: string) => import('./local-sync.mjs').DesiredPublication} publicationOf */
export async function replayPracticeImports(context, request, publicationOf) {
  const resources = (context.journal.resources ??= {});
  for (const entry of Object.values(context.journal.operations)) {
    if (!isJournalOperation(entry) || entry.status === "rejected") continue;
    const parsed = operationSchema.safeParse(entry.request);
    if (!parsed.success) continue;
    const operation = parsed.data;
    if (
      entry.status === "pending" &&
      operation.body.publicationState === "published" &&
      publicationOf(operation.body.sourceReference.materialSourceId) !==
        "published"
    )
      throw new Error(
        `${operation.body.practiceId}: an interrupted transfer was publishing this practice; repeat it with the same publication approval`,
      );
    const key = `practice:${operation.body.practiceId}`;
    const previous =
      resources[key] === undefined
        ? undefined
        : storedSchema.parse(resources[key]);
    if (
      entry.status === "applied" &&
      previous !== undefined &&
      previous.practiceVersion >=
        practiceReceiptSchema.parse(entry.result).practiceVersion
    )
      continue;
    const recovered = await recoverHistoricalReceipt(
      context,
      operation,
      request,
      "/authoring/history/practice-receipts",
    );
    if (recovered === undefined) continue;
    const receipt = practiceReceiptSchema.parse(recovered);
    resources[key] = {
      practiceVersion: receipt.practiceVersion,
      digest: digest(operation.body),
    };
    await context.persist();
  }
}
