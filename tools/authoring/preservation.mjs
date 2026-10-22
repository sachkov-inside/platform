// @ts-check
import { contentMaterials, contentTasks } from "./package.mjs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { canonical, checksum, loadPackage, taskPositions } from "./package.mjs";
import { parseJournal, parseLocalResponse } from "./local-boundaries.mjs";
import {
  authoringTarget,
  transportFor,
  assertTargetEnvironment,
} from "./target.mjs";
import { authoredTaskBody, taskChapterId } from "./task-import.mjs";
import { previewRelease, applyRelease } from "./release.mjs";
import { syncLocal } from "./local-sync.mjs";
import { targetStateSchema } from "./preservation-state.mjs";
import { refusal } from "./refusal.mjs";
import { gitAncestry, sourceCommitRelation } from "./source-commit.mjs";

/** @typedef {import('./preservation-state.mjs').ReadTargetState} ReadTargetState */
/** @typedef {import('./target.mjs').LocalTransport} LocalTransport */
const relationSchema = z.enum(["same", "forward", "unrecorded"]);
const receiptSchema = z
  .object({
    schemaVersion: z.literal(2),
    sourceCommit: z.hash("sha1"),
    target: z.string(),
    originalPackagePath: z.string(),
    originalPackageId: z.hash("sha256"),
    packagePath: z.string(),
    packageId: z.hash("sha256"),
    previewPath: z.string(),
    previewFingerprint: z.hash("sha256"),
    state: targetStateSchema,
    // How the package commit relates to the commit each selected row last received.
    relations: z.record(z.string(), relationSchema),
    fingerprint: z.hash("sha256"),
  })
  .strict();

/** Targets a content-only delivery may write; creation and policy changes use the full release. */
const deliveryTargets = () => [
  authoringTarget("stand").id,
  authoringTarget("production").id,
];

/** @param {string} path @param {unknown} value */
export async function writeImmutable(path, value) {
  const bytes = canonical(value);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
    if ((await readFile(path, "utf8")) !== bytes)
      throw new Error(
        "Immutable evidence already exists with different bytes",
        { cause: error },
      );
  }
}

/** Fresh DB policy is bound to the same identities and versions the authoring API sees.
 * @param {import('./package.mjs').Manifest} manifest
 * @param {string} stateDirectory
 * @param {string} origin
 * @param {ReadTargetState} readState
 * @param {LocalTransport} send */
export async function preservationState(
  manifest,
  stateDirectory,
  origin,
  readState,
  send,
) {
  if ((manifest.practiceDefinitions ?? []).length > 0)
    throw new Error(
      "Legacy Practice definitions require a separately reviewed release policy",
    );
  const target = authoringTarget(origin);
  if (!deliveryTargets().includes(target.id))
    throw refusal(
      "target_unsupported",
      "Content-only delivery is enabled only for the stand and production",
    );
  const environment = parseLocalResponse(
    "/authoring/import/materials/environment",
    await send("/authoring/import/materials/environment"),
  );
  assertTargetEnvironment(target, environment.mode);
  const journal = parseJournal(
    JSON.parse(
      await readFile(join(stateDirectory, "journal.json"), "utf8").catch(
        (error) => {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
            throw refusal(
              "journal_missing",
              `${stateDirectory} holds no journal for this target; review pnpm authoring:deliver reconcile and adopt the selected rows`,
              error,
            );
          throw error;
        },
      ),
    ),
  );
  if (journal.target !== target.id)
    throw new Error("Preservation journal belongs to another target");
  if (
    Object.values(journal.operations).some(
      (entry) => entry.status === "pending",
    )
  )
    throw refusal(
      "journal_pending",
      "Unfinished writes of an earlier apply are pending: repeat pnpm authoring:deliver apply with its receipt to complete them with their original keys, then preview again",
    );
  const key = /** @param {string} id */ (id) =>
    `${manifest.sourceNamespace}:${id}`;
  const materialIds = contentMaterials(manifest).map((row) =>
    key(row.sourceId),
  );
  const taskIds = contentTasks(manifest).map((row) => key(row.sourceId));
  // Unselected Materials of the package are link targets; their Reader paths come from the target.
  const contextIds = manifest.materials
    .map((row) => key(row.sourceId))
    .filter((id) => !materialIds.includes(id));
  const state = targetStateSchema.parse(
    await readState(materialIds, taskIds, contextIds),
  );
  state.materials.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  state.tasks.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  if (
    state.materials.length !== materialIds.length ||
    state.tasks.length !== taskIds.length ||
    new Set(state.materials.map((row) => row.sourceId)).size !==
      materialIds.length ||
    new Set(state.tasks.map((row) => row.sourceId)).size !== taskIds.length
  )
    throw refusal(
      "selection_not_existing",
      "Every selected existing row needs a unique fresh identity; new rows require a separate explicit release policy",
    );
  for (const row of contentMaterials(manifest)) {
    const current = state.materials.find(
      (item) => item.sourceId === key(row.sourceId),
    );
    const identity = journal.materials[key(row.sourceId)];
    if (current === undefined)
      throw refusal(
        "selection_not_existing",
        `Unknown Material identity: ${row.sourceId}`,
      );
    if (identity?.materialId !== current.materialId)
      throw refusal(
        "journal_identity_missing",
        `Unknown Material identity: ${row.sourceId}. The target holds it, but this journal does not; review pnpm authoring:deliver reconcile and adopt it explicitly`,
      );
    if (identity.contentVersion !== current.contentVersion)
      throw refusal(
        "journal_stale",
        `Material API/database/journal state differs: ${row.sourceId} (journal version ${String(identity.contentVersion)}, target ${String(current.contentVersion)}); review pnpm authoring:deliver reconcile`,
      );
    if (current.publicationState === "unpublished")
      throw new Error(
        `${row.sourceId}: existing release cannot preserve an unpublished Material`,
      );
    const api = parseLocalResponse(
      `/authoring/materials/${current.materialId}`,
      await send(`/authoring/materials/${current.materialId}`),
    );
    if (
      api.source?.id !== current.sourceId ||
      api.materialId !== current.materialId ||
      api.contentVersion !== current.contentVersion ||
      identity.contentVersion !== current.contentVersion ||
      api.metadata.access !== current.access ||
      api.publicationState !== current.publicationState
    )
      throw new Error(
        `Material API/database/journal state differs: ${row.sourceId}`,
      );
  }
  const products =
    contentTasks(manifest).length === 0
      ? []
      : parseLocalResponse(
          "/authoring/collections?kind=product",
          await send("/authoring/collections?kind=product"),
        );
  for (const task of contentTasks(manifest)) {
    const current = state.tasks.find(
      (item) => item.sourceId === key(task.sourceId),
    );
    const product = products.find(
      (item) => item.sourceId === key(task.productId),
    );
    const recordedProduct = journal.products[key(task.productId)];
    if (
      recordedProduct !== undefined &&
      recordedProduct.productId !== product?.id
    )
      throw new Error(
        `Task Product journal identity differs: ${task.sourceId}`,
      );
    if (
      current === undefined ||
      current.code !== task.sourceId ||
      product?.id !== current.productId ||
      product.archived === true
    )
      throw new Error(`Unknown Task source/product identity: ${task.sourceId}`);
    if (manifest.selection.contentOnly) {
      const bound = manifest.materials.find(
        (row) => row.practiceTaskId === task.sourceId,
      );
      const embeddedMaterialId =
        bound === undefined
          ? null
          : journal.materials[key(bound.sourceId)]?.materialId;
      if (
        current.chapterId !== taskChapterId(manifest, task) ||
        current.position !== taskPositions(manifest).get(task.sourceId) ||
        current.afterMaterialSourceId !==
          (task.afterMaterialId === undefined
            ? null
            : key(task.afterMaterialId)) ||
        current.programmeVisibility !==
          (task.programmeVisibility ?? "standalone") ||
        embeddedMaterialId === undefined ||
        current.embeddedMaterialId !== embeddedMaterialId
      )
        throw new Error(
          `${task.sourceId}: bounded content refuses Task placement changes`,
        );
    }
    const api = parseLocalResponse(
      "/authoring/import/tasks/validate",
      await send(
        "/authoring/import/tasks/validate",
        authoredTaskBody(
          manifest,
          { ...task, access: current.access },
          current.publicationState,
        ),
      ),
    );
    if (
      api.migration != null ||
      api.current?.taskId !== current.taskId ||
      api.current.code !== current.code ||
      api.current.revision !== current.revision ||
      api.current.publicationState !== current.publicationState
    )
      throw new Error(`Task API/database state differs: ${task.sourceId}`);
  }
  return state;
}

/** @param {import('./package.mjs').Manifest} original @param {import('./preservation-state.mjs').TargetState} state */
export function preservedManifest(original, state) {
  const manifest = structuredClone(original);
  const key = /** @param {string} id */ (id) =>
    `${manifest.sourceNamespace}:${id}`;
  for (const row of contentMaterials(manifest)) {
    const current = state.materials.find(
      (item) => item.sourceId === key(row.sourceId),
    );
    if (current === undefined)
      throw new Error(`Missing Material: ${row.sourceId}`);
    row.access = current.access;
  }
  for (const task of contentTasks(manifest)) {
    const current = state.tasks.find(
      (item) => item.sourceId === key(task.sourceId),
    );
    if (current === undefined)
      throw new Error(`Missing Task: ${task.sourceId}`);
    task.access = current.access;
    task.publicationState = current.publicationState;
  }
  return manifest;
}

/**
 * The relation of the package commit to the commit each selected row last received. An older or
 * diverged package is refused before any write; an unrecorded target commit is reported.
 *
 * @param {import('./package.mjs').Manifest} manifest
 * @param {import('./preservation-state.mjs').TargetState} state
 * @param {string} sourceCommit
 * @param {import('./source-commit.mjs').IsAncestor | undefined} isAncestor
 */
export async function commitRelations(
  manifest,
  state,
  sourceCommit,
  isAncestor,
) {
  for (const task of contentTasks(manifest))
    if (task.provenance.commit !== sourceCommit)
      throw refusal(
        "package_commit_mismatch",
        `${task.sourceId}: the package was exported from ${task.provenance.commit}, not ${sourceCommit}`,
      );
  const ancestry =
    isAncestor ??
    (async () => {
      throw refusal(
        "content_repository_required",
        "The target recorded another Content commit; name the Content repository to compare history",
      );
    });
  /** @type {Record<string, "same" | "forward" | "unrecorded">} */
  const relations = {};
  for (const row of [...state.materials, ...state.tasks]) {
    const relation = await sourceCommitRelation(
      row.sourceCommit,
      sourceCommit,
      ancestry,
    );
    if (relation === "older" || relation === "diverged")
      throw refusal(
        relation === "older" ? "source_commit_older" : "source_commit_diverged",
        relation === "older"
          ? `${row.sourceId}: the target holds Content ${String(row.sourceCommit)}, which is newer than this package (${sourceCommit}); export the current Content commit instead`
          : `${row.sourceId}: the target holds Content ${String(row.sourceCommit)}, which is not an ancestor of this package (${sourceCommit}); merge the Content history first`,
      );
    relations[row.sourceId] = relation;
  }
  return relations;
}

/**
 * @param {string} packagePath
 * @param {string} stateDirectory
 * @param {{
 *   sourceCommit: string;
 *   readState: ReadTargetState;
 *   request?: LocalTransport;
 *   target?: string;
 *   contentRepository?: string | undefined;
 *   accessToken?: import('./target.mjs').AccessToken | undefined;
 * }} options
 */
export async function previewPreservation(
  packagePath,
  stateDirectory,
  {
    sourceCommit,
    readState,
    request,
    target: targetName = "stand",
    contentRepository,
    accessToken,
  },
) {
  const isAncestor =
    contentRepository === undefined
      ? undefined
      : gitAncestry(resolve(contentRepository));
  z.hash("sha1").parse(sourceCommit);
  const target = authoringTarget(targetName);
  const send = request ?? transportFor(target, accessToken);
  const original = await loadPackage(packagePath);
  const state = await preservationState(
    original.manifest,
    stateDirectory,
    target.id,
    readState,
    send,
  );
  const relations = await commitRelations(
    original.manifest,
    state,
    sourceCommit,
    isAncestor,
  );
  const manifest = preservedManifest(original.manifest, state);
  const bytes = canonical(manifest);
  const directory = join(
    resolve(stateDirectory),
    "preservation",
    checksum(bytes),
  );
  const derived = join(directory, "package.json");
  await mkdir(directory, { recursive: true });
  for (const asset of manifest.assets) {
    const destination = join(directory, asset.path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(original.directory, asset.path), destination, {
      force: false,
      errorOnExist: false,
    });
  }
  await writeImmutable(derived, manifest);
  const pkg = await loadPackage(derived);
  const publish = state.materials
    .filter((row) => row.publicationState === "published")
    .map((row) => row.sourceId);
  const result = await previewRelease(derived, stateDirectory, {
    origin: target.id,
    request: send,
    publish,
    sourceCommit,
    contentRepository,
  });
  if (
    result.preview.products.some((row) => row.change !== "unchanged") ||
    result.preview.materials.some((row) => row.change === "conflict") ||
    (result.preview.tasks ?? []).some((row) => row.change === "conflict")
  )
    throw refusal(
      "preservation_conflict",
      "Preservation refuses conflicts and Product changes; use a separately reviewed release",
    );
  // The derived package carries the target's policy, so any policy change here is a defect.
  const policyChange = result.preview.materials.find(
    (row) => "publicationChange" in row || "accessChange" in row,
  );
  if (policyChange !== undefined)
    throw refusal(
      "preservation_policy_change",
      `${String(policyChange["sourceId"])}: content-only delivery would change access or publication`,
    );
  const plan = {
    schemaVersion: 2,
    sourceCommit,
    target: target.id,
    originalPackagePath: resolve(packagePath),
    originalPackageId: original.id,
    packagePath: derived,
    packageId: pkg.id,
    previewPath: result.path,
    previewFingerprint: result.preview.fingerprint,
    state,
    relations,
  };
  const receipt = receiptSchema.parse({
    ...plan,
    fingerprint: checksum(canonical(plan)),
  });
  const path = join(
    resolve(stateDirectory),
    "preservation",
    `${receipt.fingerprint}.json`,
  );
  await writeImmutable(path, receipt);
  return { path, receipt, preview: result };
}

/** The preserved policy: what a content-only apply must leave as it was.
 * @param {import('./preservation-state.mjs').TargetState} state */
const preservedPolicy = (state) => ({
  materials: state.materials.map(
    ({
      contentVersion: _version,
      sourceRevision: _revision,
      sourceCommit: _commit,
      ...row
    }) => row,
  ),
  tasks: state.tasks.map(
    ({ revision: _revision, sourceCommit: _commit, ...row }) => row,
  ),
});

/** Guard before release reconciliation can write; preserve its ordinary reviewed fingerprint checks.
 * @param {string} receiptPath @param {string} stateDirectory
 * @param {{
 *   readState: ReadTargetState;
 *   request?: LocalTransport;
 *   accessToken?: import('./target.mjs').AccessToken | undefined;
 * }} options */
export async function applyPreservation(
  receiptPath,
  stateDirectory,
  { readState, request, accessToken },
) {
  const receipt = receiptSchema.parse(
    JSON.parse(await readFile(receiptPath, "utf8")),
  );
  const { fingerprint, ...plan } = receipt;
  if (checksum(canonical(plan)) !== fingerprint)
    throw refusal(
      "receipt_changed",
      "Preservation receipt changed after review",
    );
  const original = await loadPackage(receipt.originalPackagePath);
  const pkg = await loadPackage(receipt.packagePath);
  if (original.id !== receipt.originalPackageId || pkg.id !== receipt.packageId)
    throw refusal(
      "receipt_changed",
      "Preservation packages changed after review",
    );
  const preview = z
    .object({
      fingerprint: z.string(),
      packageId: z.string(),
      packagePath: z.string(),
      target: z.string(),
    })
    .parse(JSON.parse(await readFile(receipt.previewPath, "utf8")));
  if (
    preview.fingerprint !== receipt.previewFingerprint ||
    preview.packageId !== pkg.id ||
    preview.packagePath !== receipt.packagePath ||
    preview.target !== receipt.target
  )
    throw refusal("receipt_changed", "Preservation preview binding differs");
  const target = authoringTarget(receipt.target);
  const send = request ?? transportFor(target, accessToken);
  const journal = parseJournal(
    JSON.parse(await readFile(join(stateDirectory, "journal.json"), "utf8")),
  );
  if (
    Object.values(journal.operations).some(
      (entry) => entry.status === "pending",
    )
  ) {
    // A lost answer leaves its write pending; it completes once, with its key, before anything new.
    await syncLocal(receipt.packagePath, stateDirectory, {
      origin: target.id,
      request: send,
      accessToken,
      // A published Task keeps its state, so its pending write completes with the same approval.
      publish: [...receipt.state.materials, ...receipt.state.tasks]
        .filter((row) => row.publicationState === "published")
        .map((row) => row.sourceId),
      reconcileOnly: true,
      reviewed: true,
    });
    throw refusal(
      "journal_completed",
      "Unfinished writes of an earlier apply were completed with their original keys; preview again before new writes",
    );
  }
  const current = await preservationState(
    pkg.manifest,
    stateDirectory,
    receipt.target,
    readState,
    send,
  );
  if (canonical(current) !== canonical(receipt.state))
    throw refusal(
      "target_changed",
      "Preserved target state changed; preview again before writes",
    );
  const report = await applyRelease(receipt.previewPath, stateDirectory, {
    request: send,
    accessToken,
    contextLinks: current.links,
  });
  const after = await preservationState(
    pkg.manifest,
    stateDirectory,
    receipt.target,
    readState,
    send,
  );
  if (
    canonical(preservedPolicy(after)) !==
    canonical(preservedPolicy(receipt.state))
  )
    throw refusal(
      "preservation_failed",
      "Preservation failed after apply; inspect target before retrying",
    );
  // A fresh comparison of the same package must find nothing left to write.
  const reviewed = z
    .object({ contentRepository: z.string().optional() })
    .passthrough()
    .parse(JSON.parse(await readFile(receipt.previewPath, "utf8")));
  const verification = await previewRelease(
    receipt.packagePath,
    stateDirectory,
    {
      origin: target.id,
      request: send,
      publish: after.materials
        .filter((row) => row.publicationState === "published")
        .map((row) => row.sourceId),
      sourceCommit: receipt.sourceCommit,
      contentRepository: reviewed.contentRepository,
    },
  );
  const remaining = [
    ...verification.preview.materials,
    ...(verification.preview.tasks ?? []),
  ].filter((row) => row.change !== "unchanged");
  const proof = {
    schemaVersion: 2,
    preservationFingerprint: fingerprint,
    sourceCommit: receipt.sourceCommit,
    originalPackageId: receipt.originalPackageId,
    packageId: pkg.id,
    previewFingerprint: receipt.previewFingerprint,
    before: receipt.state,
    after,
    report,
    verification: {
      preview: verification.path,
      fingerprint: verification.preview.fingerprint,
      unchanged: remaining.length === 0,
    },
  };
  const path = join(
    resolve(stateDirectory),
    "preservation",
    `${fingerprint}.applied.json`,
  );
  await writeImmutable(path, proof);
  if (remaining.length > 0)
    throw refusal(
      "verification_failed",
      `After apply the target still differs for ${remaining.map((row) => String(row["sourceId"])).join(", ")}; inspect ${path}`,
    );
  return { path, proof };
}
