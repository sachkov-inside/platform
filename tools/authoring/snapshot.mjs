// @ts-check
// Snapshot orchestration keeps constituent package bytes and the existing release safety boundary.
import { readFile, realpath, mkdir, cp } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, join, sep } from "node:path";
import { z } from "zod";
import {
  canonical,
  checksum,
  loadPackage,
  contentMaterials,
  contentTasks,
  materialRevision,
} from "./package.mjs";
import { exportCommittedPackage } from "./git-local.mjs";
import { previewRelease, applyRelease } from "./release.mjs";
import { readNamespaceState } from "./preservation-state.mjs";
import { authoringTarget, transportFor } from "./target.mjs";
import { writeImmutable } from "./preservation.mjs";

const entrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    path: z
      .string()
      .min(1)
      .refine(
        (path) =>
          !isAbsolute(path) &&
          !path.includes("\\") &&
          !path.includes(":") &&
          !path.split("/").includes(".."),
        "Expected portable relative path",
      ),
    sha256: z.hash("sha256"),
    access: z.record(z.string(), z.enum(["free", "paid"])),
  })
  .strict();
const snapshotSchema = z
  .object({
    contract: z.literal("platform-package-v2"),
    commit: z.hash("sha1"),
    entries: z.array(entrySchema).min(1).max(100),
  })
  .strict();

/** @param {string} path */
export async function isSnapshot(path) {
  const value = z.unknown().parse(JSON.parse(await readFile(path, "utf8")));
  return (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "contract")
  );
}

/** Validate every package, asset and selected identity before contacting a receiver.
 * @param {string} path */
export async function loadSnapshot(path) {
  const bytes = await readFile(path, "utf8");
  const manifest = snapshotSchema.parse(JSON.parse(bytes));
  if (canonical(manifest) !== bytes)
    throw new Error("Snapshot must use canonical JSON");
  const root = await realpath(dirname(resolve(path)));
  const selected = new Set();
  const ids = new Set();
  const taskCodes = new Set();
  const products = new Set();
  const entries = [];
  for (const entry of manifest.entries) {
    if (ids.has(entry.id)) throw new Error("Duplicate snapshot entry");
    ids.add(entry.id);
    const packagePath = await realpath(resolve(root, entry.path));
    const local = relative(root, packagePath);
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
      throw new Error("Snapshot package escapes directory");
    const pkg = await loadPackage(packagePath);
    if (pkg.id !== entry.sha256)
      throw new Error("Snapshot package checksum mismatch");
    for (const task of contentTasks(pkg.manifest)) {
      if (taskCodes.has(task.sourceId))
        throw new Error("Duplicate snapshot Task code");
      taskCodes.add(task.sourceId);
      if (task.provenance.commit !== manifest.commit)
        throw new Error("Snapshot Task commit mismatch");
    }
    for (const product of pkg.manifest.products) {
      const key = `${pkg.manifest.sourceNamespace}:${product.sourceId}`;
      if (products.has(key))
        throw new Error("Snapshot repeats Product context");
      products.add(key);
    }
    const rows = [
      ...contentMaterials(pkg.manifest),
      ...contentTasks(pkg.manifest),
    ];
    if (
      Object.keys(entry.access).length !== rows.length ||
      rows.some((row) => !Object.hasOwn(entry.access, row.sourceId))
    )
      throw new Error("Snapshot access must name exactly the selected rows");
    if ((pkg.manifest.practiceDefinitions ?? []).length)
      throw new Error(
        "Snapshot requires Tasks instead of legacy Practice writes",
      );
    for (const row of rows) {
      const key = `${pkg.manifest.sourceNamespace}:${row.sourceId}`;
      if (selected.has(key))
        throw new Error(`Duplicate selected snapshot identity: ${key}`);
      selected.add(key);
    }
    entries.push({ ...entry, packagePath, pkg });
  }
  return { id: checksum(bytes), manifest, entries };
}

/** Ignore only commit provenance when comparing selected authored content across history.
 * @param {Awaited<ReturnType<typeof loadSnapshot>>} snapshot */
function contentSignature(snapshot) {
  return canonical(
    snapshot.entries.map(({ id, pkg: { manifest } }) => ({
      id,
      access: snapshot.manifest.entries.find((entry) => entry.id === id)
        ?.access,
      materials: contentMaterials(manifest).map((row) => [
        row.sourceId,
        materialRevision(manifest, row),
      ]),
      tasks: contentTasks(manifest).map((row) => ({
        ...row,
        provenance: { ...row.provenance, commit: null },
      })),
      products: manifest.products,
      selection: manifest.selection,
    })),
  );
}

/** Derive executable access without changing a course export's original bytes.
 * @param {Awaited<ReturnType<typeof loadSnapshot>>["entries"][number]} entry
 * @param {string} stateDirectory */
async function executablePackage(entry, stateDirectory) {
  const manifest = structuredClone(entry.pkg.manifest);
  for (const row of [
    ...contentMaterials(manifest),
    ...contentTasks(manifest),
  ]) {
    row.access = entry.access[row.sourceId] === "paid" ? "closed" : "free";
  }
  const bytes = canonical(manifest);
  const directory = join(
    resolve(stateDirectory),
    "snapshot-packages",
    checksum(bytes),
  );
  await mkdir(directory, { recursive: true });
  for (const asset of manifest.assets) {
    const destination = join(directory, asset.path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(entry.pkg.directory, asset.path), destination);
  }
  const path = join(directory, "package.json");
  await writeImmutable(path, manifest);
  await loadPackage(path);
  return path;
}

/** @typedef {{origin: string; request?: import('./target.mjs').LocalTransport | undefined; accessToken?: import('./target.mjs').AccessToken | undefined; sourceCommit?: string | undefined; contentRepository?: string | undefined; exportPackage?: import('./source-commit.mjs').ExportPackage}} SnapshotOptions */

/** One committed export proves the complete snapshot, including standalone articles.
 * @param {string} packagePath @param {string} stateDirectory @param {SnapshotOptions} options */
export async function previewSnapshot(packagePath, stateDirectory, options) {
  const snapshot = await loadSnapshot(packagePath);
  const commit = options.sourceCommit ?? snapshot.manifest.commit;
  if (commit !== snapshot.manifest.commit)
    throw new Error("Snapshot commit mismatch");
  if (!options.contentRepository)
    throw new Error("Snapshot needs --content-repository");
  const exporter = options.exportPackage ?? exportCommittedPackage;
  const exported = await exporter(
    options.contentRepository,
    null,
    join(stateDirectory, "source-verification"),
    commit,
  );
  const official = await loadSnapshot(exported.packagePath);
  if (exported.commit !== commit || official.id !== snapshot.id)
    throw new Error("Snapshot does not match committed export");
  const head = await exporter(
    options.contentRepository,
    null,
    join(stateDirectory, "source-verification"),
    "HEAD",
  );
  if (
    contentSignature(await loadSnapshot(head.packagePath)) !==
    contentSignature(snapshot)
  )
    throw new Error("Snapshot content changed at Content HEAD");
  const entries = [];
  for (const entry of snapshot.entries) {
    const result = await previewRelease(
      await executablePackage(entry, stateDirectory),
      stateDirectory,
      { ...options, sourceCommit: commit, publish: "all" },
    );
    if (
      [...result.preview.materials, ...(result.preview.tasks ?? [])].some(
        (row) => row.change === "conflict",
      )
    )
      throw new Error(`Snapshot conflict: ${entry.id}`);
    entries.push({
      id: entry.id,
      previewPath: result.path,
      fingerprint: result.preview.fingerprint,
    });
  }
  const plan = {
    scope: "content-snapshot",
    packagePath: resolve(packagePath),
    packageId: snapshot.id,
    target: options.origin,
    sourceCommit: commit,
    contentRepository: resolve(options.contentRepository),
    entries,
  };
  const preview = { ...plan, fingerprint: checksum(canonical(plan)) };
  const path = join(
    resolve(stateDirectory),
    "snapshots",
    `${preview.fingerprint}.json`,
  );
  await writeImmutable(path, preview);
  return { path, preview };
}

const previewSchema = z
  .object({
    scope: z.literal("content-snapshot"),
    packagePath: z.string(),
    packageId: z.hash("sha256"),
    target: z.string(),
    sourceCommit: z.hash("sha1"),
    contentRepository: z.string(),
    entries: z.array(
      z
        .object({
          id: z.string(),
          previewPath: z.string(),
          fingerprint: z.hash("sha256"),
        })
        .strict(),
    ),
    fingerprint: z.hash("sha256"),
  })
  .strict();

/** Apply every reviewed constituent and report only rows verified by a fresh comparison.
 * A partial failure keeps normal release journals; a fresh snapshot preview resumes safely.
 * @param {string} previewPath @param {string} stateDirectory
 * @param {{request?: import('./target.mjs').LocalTransport | undefined; accessToken?: import('./target.mjs').AccessToken | undefined}} [options] */
export async function applySnapshot(previewPath, stateDirectory, options = {}) {
  const preview = previewSchema.parse(
    JSON.parse(await readFile(previewPath, "utf8")),
  );
  const { fingerprint, ...plan } = preview;
  if (checksum(canonical(plan)) !== fingerprint)
    throw new Error("Snapshot preview changed after review");
  const snapshot = await loadSnapshot(preview.packagePath);
  if (
    snapshot.id !== preview.packageId ||
    snapshot.manifest.commit !== preview.sourceCommit ||
    preview.entries.length !== snapshot.entries.length
  )
    throw new Error("Snapshot differs from reviewed preview");
  // Recheck all plans before the first write, including a later entry's changed target.
  const reviewed = [];
  for (const [index, entry] of snapshot.entries.entries()) {
    const held = preview.entries[index];
    if (!held || held.id !== entry.id)
      throw new Error("Snapshot entry binding differs");
    const original = z
      .object({ fingerprint: z.hash("sha256") })
      .parse(JSON.parse(await readFile(held.previewPath, "utf8")));
    if (original.fingerprint !== held.fingerprint)
      throw new Error("Snapshot child preview changed");
    const current = await previewRelease(
      await executablePackage(entry, stateDirectory),
      stateDirectory,
      {
        ...options,
        origin: preview.target,
        publish: "all",
        sourceCommit: preview.sourceCommit,
        contentRepository: preview.contentRepository,
      },
    );
    if (
      current.preview.fingerprint !== held.fingerprint ||
      canonical(current.preview) !==
        canonical(
          z
            .record(z.string(), z.unknown())
            .parse(JSON.parse(await readFile(held.previewPath, "utf8"))),
        )
    )
      throw new Error("Snapshot target changed; preview again");
    reviewed.push(current.preview);
  }
  let applied = 0;
  let unchanged = 0;
  const delivered = [];
  for (const [index, entry] of snapshot.entries.entries()) {
    const held = preview.entries[index];
    const before = reviewed[index];
    if (!held || !before) throw new Error("Missing snapshot review");
    const report = await applyRelease(
      held.previewPath,
      stateDirectory,
      options,
    );
    applied += report.applied;
    unchanged += report.unchanged;
    const after = await previewRelease(
      await executablePackage(entry, stateDirectory),
      stateDirectory,
      {
        ...options,
        origin: preview.target,
        publish: "all",
        sourceCommit: preview.sourceCommit,
        contentRepository: preview.contentRepository,
      },
    );
    if (
      [...after.preview.materials, ...(after.preview.tasks ?? [])].some(
        (row) => row.change !== "unchanged",
      )
    )
      throw new Error(`Snapshot verification failed: ${entry.id}`);
    const state = await readNamespaceState(
      options.request ??
        transportFor(authoringTarget(preview.target), options.accessToken),
      entry.pkg.manifest.sourceNamespace,
    );
    for (const row of contentMaterials(entry.pkg.manifest)) {
      const stored = state.materials.find(
        (item) =>
          item.sourceId ===
          `${entry.pkg.manifest.sourceNamespace}:${row.sourceId}`,
      );
      if (!stored) throw new Error("Snapshot read-back identity missing");
      delivered.push({
        kind: "material",
        sourceId: row.sourceId,
        sourcePath: row.sourcePath,
        sourceCommit: stored.source?.commit ?? null,
        status:
          before.materials.find((item) => item.sourceId === row.sourceId)
            ?.change === "unchanged"
            ? "unchanged"
            : "applied",
        revision: stored.contentVersion,
        origin: preview.target,
        recordedAt: new Date().toISOString(),
      });
    }
    for (const row of contentTasks(entry.pkg.manifest)) {
      const stored = state.tasks.find(
        (item) =>
          item.sourceId ===
          `${entry.pkg.manifest.sourceNamespace}:${row.sourceId}`,
      );
      if (!stored) throw new Error("Snapshot Task read-back identity missing");
      delivered.push({
        kind: "task",
        sourceId: row.sourceId,
        sourcePath: row.provenance.path,
        sourceCommit: stored.sourceCommit ?? null,
        status:
          before.tasks?.find((item) => item.sourceId === row.sourceId)
            ?.change === "unchanged"
            ? "unchanged"
            : "applied",
        revision: stored.revision,
        origin: preview.target,
        recordedAt: new Date().toISOString(),
      });
    }
  }
  return { applied, unchanged, delivered };
}
