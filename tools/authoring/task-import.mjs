// @ts-check
import { z } from "zod";
import { canonical, checksum, taskPositions } from "./package.mjs";
import { applyJournaled } from "./journal.mjs";
import { isJournalOperation, taskReceiptSchema } from "./local-boundaries.mjs";
import { sourceUuid } from "./markdown.mjs";
import { fingerprintAccess } from "./compatibility.mjs";

/**
 * @typedef {import("./package.mjs").Manifest} Manifest
 * @typedef {import("./package.mjs").ManifestTask} ManifestTask
 * @typedef {"published" | "unpublished"} TaskPublication
 * @typedef {z.infer<typeof taskReceiptSchema>} TaskReceipt
 * @typedef {object} TaskChange
 * @property {string} sourceId
 * @property {string} title
 * @property {"new" | "changed" | "unchanged" | "conflict"} change
 * @property {string} [conflictReason]
 * @property {{ materialId: string }} [migration]
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

/** Resolve explicit preview choices without mutating the canonical package.
 * @param {Manifest} manifest
 * @param {string[]} choices
 * @returns {{ manifest: Manifest; choices: string[] }} */
export function resolveTaskAccess(manifest, choices) {
  /** @type {Map<string, "free" | "closed">} */
  const selected = new Map();
  for (const choice of choices) {
    const [code, access, extra] = choice.split("=");
    if (
      code === undefined ||
      code.length === 0 ||
      extra !== undefined ||
      (access !== "free" && access !== "closed")
    )
      throw new Error("Task access choice must be code=free or closed");
    const task = (manifest.tasks ?? []).find((task) => task.sourceId === code);
    if (task === undefined)
      throw new Error(`Unknown Task access code: ${code}`);
    const previous = selected.get(code);
    if (previous !== undefined && previous !== access)
      throw new Error(`Conflicting Task access choices: ${code}`);
    if (task.access !== null && task.access !== access)
      throw new Error(
        `${code}: Task access is already explicitly ${task.access}`,
      );
    selected.set(code, access);
  }
  return {
    manifest:
      selected.size === 0
        ? manifest
        : {
            ...manifest,
            tasks: (manifest.tasks ?? []).map((task) => ({
              ...task,
              access: selected.get(task.sourceId) ?? task.access,
            })),
          },
    choices: [...selected].map(([code, access]) => `${code}=${access}`).sort(),
  };
}

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
 * The authored task as validation reads it, before its Product may exist on the target.
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
    ...(task.page === undefined ? {} : { page: task.page }),
    relatedMaterialSourceIds: task.relatedMaterialIds.map((id) =>
      sourceKey(manifest, id),
    ),
    // Absent means the start of the chapter; a task without a place keeps its earlier digest.
    ...(task.afterMaterialId === undefined
      ? {}
      : { afterMaterialSourceId: sourceKey(manifest, task.afterMaterialId) }),
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
      ...(task.page === undefined
        ? {}
        : {
            pageAssets: manifest.assets.filter((asset) =>
              [
                ...Object.values(task.page?.images ?? {}),
                task.page?.coverAssetId,
                ...(task.page?.artifacts ?? []).map(
                  (artifact) => artifact.assetId,
                ),
              ].includes(asset.sourceId),
            ),
          }),
      access: fingerprintAccess(state.access),
      guide: task.productId,
      chapter: task.chapterId,
      position: taskPositions(manifest).get(task.sourceId),
    }),
  );
}

/** @param {Manifest} manifest @param {ManifestTask} task */
export function taskChapterId(manifest, task) {
  return sourceUuid(
    `${sourceKey(manifest, task.productId)}:chapter:${task.chapterId}`,
  );
}

/** Every task is checked by the backend before the first write of a transfer.
 * @param {Manifest} manifest
 * @param {import('./local-boundaries.mjs').LocalRequest} request */
export async function validateSourceTasks(manifest, request) {
  for (const task of manifest.tasks ?? []) {
    const result = await request(
      "/authoring/import/tasks/validate",
      authoredBody(manifest, task, task.publicationState),
    );
    if (result.migration != null)
      throw new Error(
        `${task.sourceId}: material_to_task_migration requires a release decision`,
      );
  }
}

/** A pending Task command may finish only with the same access decision.
 * @param {Manifest} manifest
 * @param {import('./journal.mjs').Journal} journal */
export function assertTaskReplayAccess(manifest, journal) {
  for (const entry of Object.values(journal.operations)) {
    if (!isJournalOperation(entry) || entry.status !== "pending") continue;
    const parsed = operationSchema.safeParse(entry.request);
    if (!parsed.success) continue;
    const task = (manifest.tasks ?? []).find(
      (task) => task.sourceId === parsed.data.body.code,
    );
    if (
      task !== undefined &&
      fingerprintAccess(task.access) !==
        fingerprintAccess(parsed.data.body["access"])
    )
      throw new Error(
        `${task.sourceId}: an interrupted Task transfer used a different access decision; apply its original preview first`,
      );
  }
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
 * Imports every task of the package after its Product and chapters. A task the package omits stays
 * unchanged on the target. A target that changed since this journal's last import stops the
 * transfer instead of being overwritten.
 *
 * @param {Manifest} manifest
 * @param {import('./journal.mjs').JournalContext} context
 * @param {import('./local-boundaries.mjs').LocalRequest} request
 * @param {{ productIdOf: (productSourceId: string) => string; selected: (sourceKey: string) => boolean; pageOf?: (task: ManifestTask) => Promise<import("./task-page.mjs").PageImport> }} options
 * @returns {Promise<TaskChange[]>}
 */
export async function syncSourceTasks(
  manifest,
  context,
  request,
  { productIdOf, selected, pageOf },
) {
  const resources = (context.journal.resources ??= {});
  const positions = taskPositions(manifest);
  /** @type {TaskChange[]} */
  const changes = [];
  for (const task of manifest.tasks ?? []) {
    const { current, migration } = await request(
      "/authoring/import/tasks/validate",
      authoredBody(manifest, task, task.publicationState),
    );
    if (migration != null)
      throw new Error(
        `${task.sourceId}: material_to_task_migration requires a release decision`,
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
      ...(task.page === undefined || pageOf === undefined
        ? {}
        : await pageOf(task)),
      productId: productIdOf(task.productId),
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
    if (task.access === null) {
      tasks.push({
        sourceId: task.sourceId,
        title: task.title,
        publication: task.publicationState,
        change: "conflict",
        conflictReason: "task_access_decision",
      });
      continue;
    }
    const { current, migration } = await request(
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
      ...(migration == null ? {} : { migration }),
      ...(migration != null ||
      journal.materials[sourceKey(manifest, task.sourceId)] !== undefined
        ? { conflictReason: "material_to_task_migration" }
        : {}),
      change:
        migration != null ||
        journal.materials[sourceKey(manifest, task.sourceId)] !== undefined
          ? "conflict"
          : previous !== undefined && previous.revision !== current?.revision
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
