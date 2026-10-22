// @ts-check
// Journal reconciliation (#1672): the client journal and the Materials a target actually holds must
// agree, or the gap must be explicit. Adoption records an existing target Material in the journal;
// it writes nothing to the target and never invents an identity the target does not report.
import { z } from "zod";

import { canonical, checksum } from "./package.mjs";
import { withJournal } from "./journal.mjs";
import { parseLocalResponse } from "./local-boundaries.mjs";
import { readNamespaceState } from "./preservation-state.mjs";
import { refusal } from "./refusal.mjs";
import { taskJournalReceiptSchema, taskResourceKey } from "./task-import.mjs";

/**
 * @typedef {"agree" | "journal_only" | "target_only" | "identity_differs" | "version_differs"} ReconcileStatus
 * @typedef {{
 *   sourceId: string;
 *   status: ReconcileStatus;
 *   materialId: string | null;
 *   journalMaterialId: string | null;
 *   contentVersion: number | null;
 *   journalContentVersion: number | null;
 *   publicationState: string | null;
 *   sourceCommit: string | null;
 * }} ReconcileRow
 */

/**
 * @param {string} stateDirectory
 * @param {{
 *   target: import("./target.mjs").AuthoringTarget;
 *   send: import("./target.mjs").LocalTransport;
 *   namespace: string;
 *   adopt?: string[];
 *   now?: () => Date;
 * }} options
 */
export async function reconcileJournal(
  stateDirectory,
  { target, send, namespace, adopt = [], now = () => new Date() },
) {
  const state = await readNamespaceState(send, namespace);
  const products = parseLocalResponse(
    "/authoring/collections?kind=product",
    await send("/authoring/collections?kind=product"),
  );
  // An adopted row names its Products, so a later release of one Product never proposes archiving it.
  const productSource = new Map(
    products.flatMap((product) =>
      typeof product.sourceId === "string"
        ? [[product.id, product.sourceId]]
        : [],
    ),
  );
  const key = (/** @type {string} */ id) =>
    id.includes(":") ? id : `${namespace}:${id}`;
  const adopted = [...new Set(adopt.map(key))].sort();
  /**
   * The `adopted:<source key>` receipt: when, from which status and journal entry, to what.
   *
   * @param {string} status
   * @param {unknown} previous
   * @param {Record<string, string | number>} recorded
   */
  const adoption = (status, previous, recorded) => ({
    at: now().toISOString(),
    status,
    previous: previous === undefined ? null : canonicalEntry(previous),
    ...recorded,
  });
  return withJournal(
    stateDirectory,
    target.id,
    async ({ journal, persist }) => {
      const held = new Map(state.materials.map((row) => [row.sourceId, row]));
      const keys = [
        ...new Set([
          ...Object.keys(journal.materials).filter((id) =>
            id.startsWith(`${namespace}:`),
          ),
          ...held.keys(),
        ]),
      ].sort();
      /** @type {ReconcileRow[]} */
      const rows = keys.map((sourceId) => {
        const entry = journal.materials[sourceId];
        const current = held.get(sourceId);
        /** @type {ReconcileStatus} */
        const status =
          current === undefined
            ? "journal_only"
            : entry === undefined
              ? "target_only"
              : entry.materialId !== current.materialId
                ? "identity_differs"
                : entry.contentVersion !== current.contentVersion
                  ? "version_differs"
                  : "agree";
        return {
          sourceId,
          status,
          materialId: current?.materialId ?? null,
          journalMaterialId: entry?.materialId ?? null,
          contentVersion: current?.contentVersion ?? null,
          journalContentVersion: entry?.contentVersion ?? null,
          publicationState: current?.publicationState ?? null,
          sourceCommit: current?.source.commit ?? null,
        };
      });
      const resources = (journal.resources ??= {});
      const heldTasks = new Map(state.tasks.map((row) => [row.sourceId, row]));
      // A Task's journal receipt records the revision this journal last wrote; another journal may
      // have revised it since, and apply refuses to overwrite that unseen revision.
      const taskRows = state.tasks.map((current) => {
        const receipt = taskJournalReceiptSchema.safeParse(
          resources[taskResourceKey(current.code)],
        );
        const stored = resources[taskResourceKey(current.code)];
        /** @type {"agree" | "target_only" | "version_differs" | "receipt_invalid"} */
        const status =
          stored === undefined
            ? "target_only"
            : !receipt.success
              ? "receipt_invalid"
              : receipt.data.revision === current.revision
                ? "agree"
                : "version_differs";
        return {
          sourceId: current.sourceId,
          status,
          taskId: current.taskId,
          revision: current.revision,
          journalRevision: receipt.success ? receipt.data.revision : null,
          publicationState: current.publicationState,
          sourceCommit: current.sourceCommit,
        };
      });
      for (const sourceId of adopted) {
        const task = heldTasks.get(sourceId);
        if (task !== undefined && held.has(sourceId))
          throw refusal(
            "adopt_ambiguous",
            `${sourceId}: the target holds both a Material and a Task with this source identity; a release decides that migration`,
          );
        if (task !== undefined) {
          const row = taskRows.find((item) => item.sourceId === sourceId);
          if (row === undefined || row.status === "agree") continue;
          const previous = resources[taskResourceKey(task.code)];
          // As for Materials, the digest matches no package, so the next preview shows the Task as changed.
          resources[taskResourceKey(task.code)] = {
            revision: task.revision,
            digest: checksum(
              canonical({
                adopted: sourceId,
                taskId: task.taskId,
                revision: task.revision,
              }),
            ),
          };
          resources[`adopted:${sourceId}`] = adoption(row.status, previous, {
            taskId: task.taskId,
            revision: task.revision,
          });
          row.status = "agree";
          row.journalRevision = task.revision;
          continue;
        }
        const row = rows.find((item) => item.sourceId === sourceId);
        const current = held.get(sourceId);
        if (row === undefined || current === undefined)
          throw refusal(
            "adopt_unknown",
            `${sourceId}: the target holds no Material or Task with this source identity`,
          );
        if (row.status === "agree") continue;
        const previous = journal.materials[sourceId];
        // The digest is never one a package produces, so the next preview shows the row as changed.
        journal.materials[sourceId] = {
          materialId: current.materialId,
          contentVersion: current.contentVersion,
          digest: checksum(
            canonical({
              adopted: sourceId,
              materialId: current.materialId,
              contentVersion: current.contentVersion,
            }),
          ),
          revision: current.source.revision,
          publicationState: current.publicationState,
          archived: current.publicationState === "unpublished",
          access: current.access,
          productSourceIds: current.memberships.flatMap((membership) => {
            const sourceId = productSource.get(membership.productId);
            return sourceId === undefined ? [] : [sourceId];
          }),
          ...(current.slug === null
            ? {}
            : { url: `/materials/${current.slug}` }),
        };
        resources[`adopted:${sourceId}`] = adoption(row.status, previous, {
          materialId: current.materialId,
          contentVersion: current.contentVersion,
        });
        row.status = "agree";
        row.journalMaterialId = current.materialId;
        row.journalContentVersion = current.contentVersion;
      }
      if (adopted.length > 0) await persist();
      const counts = tally(rows, [
        "agree",
        "journal_only",
        "target_only",
        "identity_differs",
        "version_differs",
      ]);
      return {
        target: target.id,
        namespace,
        counts,
        adopted,
        materials: rows,
        tasks: taskRows,
        taskCounts: tally(taskRows, [
          "agree",
          "target_only",
          "version_differs",
        ]),
      };
    },
  );
}

/**
 * The entry as the journal file stores it, without fields canonical JSON drops.
 *
 * @param {unknown} entry
 */
const canonicalEntry = (entry) => z.json().parse(JSON.parse(canonical(entry)));

/**
 * Rows per status, every listed status present.
 *
 * @param {{ status: string }[]} rows
 * @param {string[]} statuses
 */
function tally(rows, statuses) {
  return Object.fromEntries(
    statuses.map((status) => [
      status,
      rows.filter((row) => row.status === status).length,
    ]),
  );
}
