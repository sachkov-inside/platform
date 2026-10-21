// @ts-check
import { contentMaterials, contentTasks } from "./package.mjs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { canonical, checksum, loadPackage } from "./package.mjs";
import { parseJournal, parseLocalResponse } from "./local-boundaries.mjs";
import {
  authoringTarget,
  transportFor,
  assertTargetEnvironment,
} from "./target.mjs";
import { authoredTaskBody } from "./task-import.mjs";
import { previewRelease, applyRelease } from "./release.mjs";
import {
  targetStateSchema,
  postgresPreservationState,
} from "./preservation-state.mjs";

/** @typedef {import('./preservation-state.mjs').ReadTargetState} ReadTargetState */
/** @typedef {import('./target.mjs').LocalTransport} LocalTransport */
const receiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceCommit: z.hash("sha1"),
    target: z.string(),
    originalPackagePath: z.string(),
    originalPackageId: z.hash("sha256"),
    packagePath: z.string(),
    packageId: z.hash("sha256"),
    previewPath: z.string(),
    previewFingerprint: z.hash("sha256"),
    state: targetStateSchema,
    fingerprint: z.hash("sha256"),
  })
  .strict();

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
  if (target.kind !== "local" || target.id !== authoringTarget("stand").id)
    throw new Error("Preservation is enabled only for the local stand");
  const environment = parseLocalResponse(
    "/authoring/import/materials/environment",
    await send("/authoring/import/materials/environment"),
  );
  assertTargetEnvironment(target, environment.mode);
  const journal = parseJournal(
    JSON.parse(await readFile(join(stateDirectory, "journal.json"), "utf8")),
  );
  if (journal.target !== target.id)
    throw new Error("Preservation journal belongs to another target");
  if (
    Object.values(journal.operations).some(
      (entry) => entry.status === "pending",
    )
  )
    throw new Error(
      "Resolve pending release operations before preservation preview/apply",
    );
  const key = /** @param {string} id */ (id) =>
    `${manifest.sourceNamespace}:${id}`;
  const materialIds = contentMaterials(manifest).map((row) =>
    key(row.sourceId),
  );
  const taskIds = contentTasks(manifest).map((row) => key(row.sourceId));
  const state = targetStateSchema.parse(await readState(materialIds, taskIds));
  state.materials.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  state.tasks.sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  if (
    state.materials.length !== materialIds.length ||
    state.tasks.length !== taskIds.length ||
    new Set(state.materials.map((row) => row.sourceId)).size !==
      materialIds.length ||
    new Set(state.tasks.map((row) => row.sourceId)).size !== taskIds.length
  )
    throw new Error(
      "Every selected existing row needs a unique fresh identity; new rows require a separate explicit release policy",
    );
  for (const row of contentMaterials(manifest)) {
    const current = state.materials.find(
      (item) => item.sourceId === key(row.sourceId),
    );
    const identity = journal.materials[key(row.sourceId)];
    if (current === undefined || identity?.materialId !== current.materialId)
      throw new Error(`Unknown Material identity: ${row.sourceId}`);
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

/** @param {string} packagePath @param {string} stateDirectory
 * @param {{ sourceCommit: string; readState: ReadTargetState; request?: LocalTransport }} options */
export async function previewPreservation(
  packagePath,
  stateDirectory,
  { sourceCommit, readState, request },
) {
  z.hash("sha1").parse(sourceCommit);
  const target = authoringTarget("stand");
  const send = request ?? transportFor(target, undefined);
  const original = await loadPackage(packagePath);
  const state = await preservationState(
    original.manifest,
    stateDirectory,
    target.id,
    readState,
    send,
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
  });
  if (
    result.preview.products.some((row) => row.change !== "unchanged") ||
    result.preview.materials.some((row) => row.change === "conflict") ||
    (result.preview.tasks ?? []).some((row) => row.change === "conflict")
  )
    throw new Error(
      "Preservation refuses conflicts and Product changes; use a separately reviewed release",
    );
  const plan = {
    schemaVersion: 1,
    sourceCommit,
    target: target.id,
    originalPackagePath: resolve(packagePath),
    originalPackageId: original.id,
    packagePath: derived,
    packageId: pkg.id,
    previewPath: result.path,
    previewFingerprint: result.preview.fingerprint,
    state,
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

/** Guard before release reconciliation can write; preserve its ordinary reviewed fingerprint checks.
 * @param {string} receiptPath @param {string} stateDirectory
 * @param {{ readState: ReadTargetState; request?: LocalTransport }} options */
export async function applyPreservation(
  receiptPath,
  stateDirectory,
  { readState, request },
) {
  const receipt = receiptSchema.parse(
    JSON.parse(await readFile(receiptPath, "utf8")),
  );
  const { fingerprint, ...plan } = receipt;
  if (checksum(canonical(plan)) !== fingerprint)
    throw new Error("Preservation receipt changed after review");
  const original = await loadPackage(receipt.originalPackagePath);
  const pkg = await loadPackage(receipt.packagePath);
  if (original.id !== receipt.originalPackageId || pkg.id !== receipt.packageId)
    throw new Error("Preservation packages changed after review");
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
    throw new Error("Preservation preview binding differs");
  const send =
    request ?? transportFor(authoringTarget(receipt.target), undefined);
  const current = await preservationState(
    pkg.manifest,
    stateDirectory,
    receipt.target,
    readState,
    send,
  );
  if (canonical(current) !== canonical(receipt.state))
    throw new Error(
      "Preserved target state changed; preview again before writes",
    );
  const report = await applyRelease(receipt.previewPath, stateDirectory, {
    request: send,
  });
  const after = await preservationState(
    pkg.manifest,
    stateDirectory,
    receipt.target,
    readState,
    send,
  );
  const policy =
    /** @param {import('./preservation-state.mjs').TargetState} state */ (
      state,
    ) => ({
      materials: state.materials.map(
        ({ contentVersion: _version, ...row }) => row,
      ),
      tasks: state.tasks.map(({ revision: _revision, ...row }) => row),
    });
  if (canonical(policy(after)) !== canonical(policy(receipt.state)))
    throw new Error(
      "Preservation failed after apply; inspect target before retrying",
    );
  const proof = {
    schemaVersion: 1,
    preservationFingerprint: fingerprint,
    sourceCommit: receipt.sourceCommit,
    originalPackageId: receipt.originalPackageId,
    packageId: pkg.id,
    previewFingerprint: receipt.previewFingerprint,
    before: receipt.state,
    after,
    report,
  };
  const path = join(
    resolve(stateDirectory),
    "preservation",
    `${fingerprint}.applied.json`,
  );
  await writeImmutable(path, proof);
  return { path, proof };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      package: { type: "string" },
      state: { type: "string" },
      commit: { type: "string" },
      receipt: { type: "string" },
    },
  });
  const databaseUrl = process.env["AUTHORING_PRESERVATION_DATABASE_URL"];
  if (databaseUrl === undefined)
    throw new Error(
      "Set AUTHORING_PRESERVATION_DATABASE_URL to the local stand database",
    );
  const readState = postgresPreservationState(databaseUrl);
  if (
    positionals[0] === "preview" &&
    values.package &&
    values.state &&
    values.commit
  ) {
    const result = await previewPreservation(values.package, values.state, {
      sourceCommit: values.commit,
      readState,
    });
    process.stdout.write(
      `${JSON.stringify({ receipt: result.path, preview: result.preview.path, packageId: result.receipt.packageId })}\n`,
    );
  } else if (positionals[0] === "apply" && values.receipt && values.state) {
    const result = await applyPreservation(values.receipt, values.state, {
      readState,
    });
    process.stdout.write(`${JSON.stringify({ proof: result.path })}\n`);
  } else
    throw new Error(
      "Usage: authoring:preserve preview --package PACKAGE_JSON --state STATE_DIRECTORY --commit SOURCE_SHA | apply --receipt RECEIPT_JSON --state STATE_DIRECTORY",
    );
}
