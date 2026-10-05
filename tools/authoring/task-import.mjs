// @ts-check
import { z } from "zod";
import { canonical, checksum, taskPositions } from "./package.mjs";
import { applyJournaled } from "./journal.mjs";
import { isJournalOperation, taskReceiptSchema } from "./local-boundaries.mjs";
import { sourceUuid } from "./markdown.mjs";

/**
 * @typedef {import("./package.mjs").Manifest} Manifest
 * @typedef {import("./package.mjs").ManifestTask} ManifestTask
 * @typedef {"published" | "unpublished"} TaskPublication
 * @typedef {z.infer<typeof taskReceiptSchema>} TaskReceipt
 * @typedef {object} TaskChange
 * @property {string} sourceId
 * @property {string} title
 * @property {"new" | "changed" | "unchanged" | "conflict"} change
 * @property {TaskPublication} publication
 * @property {{ from: TaskPublication; to: TaskPublication }} [publicationChange]
 */

const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const storedSchema = z
  .object({ revision: version, digest: z.hash("sha256") })
  .strict();
const operationSchema = z
  .object({
    path: z.literal("/authoring/import/tasks/apply"),
    body: z
      .object({
        code: z.string(),
        sourceId: z.string(),
        publicationState: z.enum(["published", "unpublished"]),
      })
      .passthrough(),
  })
  .strict();

/** @param {Pick<Manifest, "sourceNamespace">} manifest @param {string} id */
const sourceKey = (manifest, id) => `${manifest.sourceNamespace}:${id}`;
/** @param {string} code */
const resourceKey = (code) => `task:${code}`;

/**
 * The publication a task asks for: Content's `unpublished` withdraws it; `published` takes effect
 * only for a task the owner selected (`--publish` or `--publish-all`). Otherwise the target keeps
 * what it holds, and a new task stays unpublished.
 *
 * @param {ManifestTask} task
 * @param {boolean} selected
 * @param {TaskPublication | undefined} current
 * @returns {TaskPublication}
 */
export function taskPublication(task, selected, current) {
  if (task.publicationState === "unpublished") return "unpublished";
  return selected ? "published" : (current ?? "unpublished");
}

/**
 * The authored task as validation reads it, before its Guide may exist on the target.
 *
 * @param {Manifest} manifest
 * @param {ManifestTask} task
 * @param {TaskPublication} publicationState
 */
function authoredBody(manifest, task, publicationState) {
  return {
    sourceId: sourceKey(manifest, task.sourceId),
    code: task.sourceId,
    title: task.title,
    access: task.access,
    definition: task.definition,
    relatedMaterialSourceIds: task.relatedMaterialIds.map((id) =>
      sourceKey(manifest, id),
    ),
    publicationState,
    provenance: task.provenance,
  };
}

/**
 * The state the package asks the target to hold; provenance changes with every commit and is not
 * a change of the task.
 *
 * @param {Manifest} manifest
 * @param {ManifestTask} task
 * @param {TaskPublication} publicationState
 */
export function taskDigest(manifest, task, publicationState) {
  const { provenance: _provenance, ...state } = authoredBody(
    manifest,
    task,
    publicationState,
  );
  return checksum(
    canonical({
      ...state,
      guide: task.guideId,
      chapter: task.chapterId,
      position: taskPositions(manifest).get(task.sourceId),
    }),
  );
}

/** @param {Manifest} manifest @param {ManifestTask} task */
export function taskChapterId(manifest, task) {
  return sourceUuid(
    `${sourceKey(manifest, task.guideId)}:chapter:${task.chapterId}`,
  );
}

/** Every task is checked by the backend before the first write of a transfer.
 * @param {Manifest} manifest
 * @param {import('./local-boundaries.mjs').LocalRequest} request */
export async function validateSourceTasks(manifest, request) {
  for (const task of manifest.tasks ?? [])
    await request(
      "/authoring/import/tasks/validate",
      authoredBody(manifest, task, task.publicationState),
    );
}

/**
 * Completes a task import this journal started with its original key. An unfinished publication
 * resumes only when this run approves it again.
 *
 * @param {import('./journal.mjs').JournalContext} context
 * @param {import('./local-boundaries.mjs').LocalRequest} request
 * @param {(sourceKey: string) => boolean} selected
 */
export async function replayTaskImports(context, request, selected) {
  const resources = (context.journal.resources ??= {});
  for (const entry of Object.values(context.journal.operations)) {
    if (!isJournalOperation(entry) || entry.status === "rejected") continue;
    const parsed = operationSchema.safeParse(entry.request);
    if (!parsed.success) continue;
    const operation = parsed.data;
    if (
      entry.status === "pending" &&
      operation.body.publicationState === "published" &&
      !selected(operation.body.sourceId)
    )
      throw new Error(
        `${operation.body.code}: an interrupted transfer was publishing this task; repeat it with the same publication approval`,
      );
    if (entry.status === "applied") continue;
    const receipt = taskReceiptSchema.parse(
      await applyJournaled(context, operation, (replayed, idempotencyKey) =>
        request(replayed.path, replayed.body, idempotencyKey),
      ),
    );
    // The digest is unknown here; the next transfer compares and sends the package state again.
    delete resources[resourceKey(receipt.code)];
    await context.persist();
  }
}

/**
 * Imports every task of the package after its Guide and chapters. A task the package omits stays
 * unchanged on the target. A target that changed since this journal's last import stops the
 * transfer instead of being overwritten.
 *
 * @param {Manifest} manifest
 * @param {import('./journal.mjs').JournalContext} context
 * @param {import('./local-boundaries.mjs').LocalRequest} request
 * @param {{ guideIdOf: (guideSourceId: string) => string; selected: (sourceKey: string) => boolean }} options
 * @returns {Promise<TaskChange[]>}
 */
export async function syncSourceTasks(
  manifest,
  context,
  request,
  { guideIdOf, selected },
) {
  const resources = (context.journal.resources ??= {});
  const positions = taskPositions(manifest);
  /** @type {TaskChange[]} */
  const changes = [];
  for (const task of manifest.tasks ?? []) {
    const { current } = await request(
      "/authoring/import/tasks/validate",
      authoredBody(manifest, task, task.publicationState),
    );
    const key = resourceKey(task.sourceId);
    const previous =
      resources[key] === undefined
        ? undefined
        : storedSchema.parse(resources[key]);
    if (previous !== undefined && previous.revision !== current?.revision)
      throw new Error(
        `${task.sourceId}: the task changed on the target; reconcile before overwriting`,
      );
    const publicationState = taskPublication(
      task,
      selected(sourceKey(manifest, task.sourceId)),
      current?.publicationState,
    );
    const digest = taskDigest(manifest, task, publicationState);
    const item = {
      sourceId: task.sourceId,
      title: task.title,
      publication: publicationState,
      ...(current !== null && current.publicationState !== publicationState
        ? {
            publicationChange: {
              from: current.publicationState,
              to: publicationState,
            },
          }
        : {}),
    };
    if (previous?.digest === digest) {
      changes.push({ ...item, change: "unchanged" });
      continue;
    }
    const body = {
      ...authoredBody(manifest, task, publicationState),
      guideId: guideIdOf(task.guideId),
      chapterId: taskChapterId(manifest, task),
      position: positions.get(task.sourceId),
      expectedRevision: current?.revision ?? null,
    };
    const receipt = taskReceiptSchema.parse(
      await applyJournaled(
        context,
        { path: "/authoring/import/tasks/apply", body },
        (operation, idempotencyKey) =>
          request(operation.path, operation.body, idempotencyKey),
      ),
    );
    resources[key] = { revision: receipt.revision, digest };
    await context.persist();
    changes.push({
      ...item,
      change:
        current === null
          ? "new"
          : receipt.revision === current.revision
            ? "unchanged"
            : "changed",
    });
  }
  return changes;
}

/**
 * What a release would do with the package's tasks, read from the target without a write. A task
 * whose target revision differs from the journal is a conflict that apply refuses.
 *
 * @param {Manifest} manifest
 * @param {import('./journal.mjs').Journal} journal
 * @param {import('./local-boundaries.mjs').LocalRequest} request
 * @param {(sourceKey: string) => boolean} selected
 * @returns {Promise<{ tasks: TaskChange[]; expected: Record<string, number> }>}
 */
export async function previewTasks(manifest, journal, request, selected) {
  const resources = journal.resources ?? {};
  /** @type {TaskChange[]} */
  const tasks = [];
  /** @type {Record<string, number>} */
  const expected = {};
  for (const task of manifest.tasks ?? []) {
    const { current } = await request(
      "/authoring/import/tasks/validate",
      authoredBody(manifest, task, task.publicationState),
    );
    expected[resourceKey(task.sourceId)] = current?.revision ?? 0;
    const stored = resources[resourceKey(task.sourceId)];
    const previous =
      stored === undefined ? undefined : storedSchema.parse(stored);
    const publication = taskPublication(
      task,
      selected(sourceKey(manifest, task.sourceId)),
      current?.publicationState,
    );
    tasks.push({
      sourceId: task.sourceId,
      title: task.title,
      publication,
      change:
        previous !== undefined && previous.revision !== current?.revision
          ? "conflict"
          : current === null
            ? "new"
            : previous?.digest === taskDigest(manifest, task, publication)
              ? "unchanged"
              : "changed",
      ...(current !== null && current.publicationState !== publication
        ? {
            publicationChange: {
              from: current.publicationState,
              to: publication,
            },
          }
        : {}),
    });
  }
  return { tasks, expected };
}
