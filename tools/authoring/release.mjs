import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { loadPackage, canonical, checksum } from "./package.mjs";
import { writeAtomic } from "./journal.mjs";
import { parseJournal, parseLocalResponse } from "./local-boundaries.mjs";
import { materialRevision, syncLocal } from "./local-sync.mjs";
import { loopbackOrigin, localTargets, localTransport, resolveLocalTarget } from "./target.mjs";

// A release applies one reviewed package to one environment. Only local environments are enabled:
// production needs an owner-approved credential path and an explicit approval of this command.
export function releaseTarget(value) {
  if (Object.hasOwn(localTargets, value)) return resolveLocalTarget(value);
  try {
    return loopbackOrigin(value);
  } catch {
    throw new Error(`Release to ${value} is not enabled: a non-local release needs a separate owner approval and credential path`);
  }
}

async function readJournal(stateDirectory, target) {
  try {
    const journal = parseJournal(JSON.parse(await readFile(join(resolve(stateDirectory), "journal.json"), "utf8")));
    if (journal.target !== target) throw new Error("Release state belongs to another environment");
    return journal;
  } catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: 1, target, materials: {}, guides: {}, operations: {}, resources: {} };
    throw error;
  }
}

/** Read-only comparison of a package with what this environment already holds. */
export async function previewRelease(packagePath, stateDirectory, { origin, request: transport } = {}) {
  const target = loopbackOrigin(origin);
  const send = transport ?? localTransport(target);
  const request = async (path) => parseLocalResponse(path, await send(path));
  const pkg = await loadPackage(packagePath);
  const environment = await request("/authoring/import/materials/environment");
  const journal = await readJournal(stateDirectory, target);
  const namespace = pkg.manifest.sourceNamespace;
  const materials = [];
  const expected = {};
  for (const row of pkg.manifest.materials) {
    const key = `${namespace}:${row.sourceId}`;
    const entry = journal.materials[key];
    const item = { sourceId: row.sourceId, title: row.title, access: row.access, showInFeed: row.showInFeed, video: row.video?.kinescopeId ?? null, cover: row.coverAssetId !== null, artifacts: row.artifacts.length };
    if (!entry) { materials.push({ ...item, change: "new" }); continue; }
    const current = await request(`/authoring/materials/${entry.materialId}`);
    expected[key] = current.contentVersion;
    const drifted = current.contentVersion !== entry.contentVersion;
    const change = drifted ? "conflict" : entry.archived ? "restore" : entry.revision !== materialRevision(pkg.manifest, row) ? "changed" : "unchanged";
    materials.push({
      ...item, change,
      ...(current.source?.showInFeed !== undefined && current.source.showInFeed !== row.showInFeed ? { feedChange: { from: current.source.showInFeed, to: row.showInFeed } } : {}),
      ...(entry.access !== undefined && row.access !== null && entry.access !== row.access ? { accessChange: { from: entry.access, to: row.access } } : {}),
    });
  }
  const guides = [];
  for (const guide of pkg.manifest.guides) {
    const entry = journal.guides[`${namespace}:${guide.sourceId}`];
    const programme = [...guide.materialIds, ...guide.supplementaryMaterialIds];
    if (!entry) { guides.push({ sourceId: guide.sourceId, title: guide.title, change: "new", materials: programme.length }); continue; }
    const order = await request(`/authoring/guides/${entry.guideId}/order`);
    expected[`${namespace}:${guide.sourceId}:order`] = order.orderVersion;
    guides.push({ sourceId: guide.sourceId, title: guide.title, change: "existing", materials: programme.length, chapters: guide.chapters.length });
  }
  const selected = new Set(pkg.manifest.guides.map((guide) => `${namespace}:${guide.sourceId}`));
  const archiveProposals = Object.entries(journal.materials)
    .filter(([key, entry]) => key.startsWith(`${namespace}:`) && !entry.archived && !pkg.manifest.materials.some((row) => `${namespace}:${row.sourceId}` === key)
      && (!entry.guideSourceIds || entry.guideSourceIds.some((id) => selected.has(id))))
    .map(([key]) => key);
  const plan = { schemaVersion: 1, target, environment: environment.mode, packageId: pkg.id, packagePath: resolve(packagePath), expected, materials, guides, archiveProposals };
  const preview = { ...plan, fingerprint: checksum(canonical(plan)) };
  const summary = Object.fromEntries(["new", "changed", "restore", "unchanged", "conflict"].map((change) => [change, materials.filter((item) => item.change === change).length]));
  const directory = join(resolve(stateDirectory), "previews");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${preview.fingerprint}.json`);
  await writeAtomic(path, preview);
  return { path, preview, summary };
}

const previewSchema = z.object({
  schemaVersion: z.literal(1), target: z.string(), environment: z.string(), packageId: z.hash("sha256"), packagePath: z.string(),
  expected: z.record(z.string(), z.union([z.number().int(), z.string()])), materials: z.array(z.object({ change: z.string() }).passthrough()),
  guides: z.array(z.json()), archiveProposals: z.array(z.string()), fingerprint: z.hash("sha256"),
}).strict();

/** Applies exactly the reviewed preview; any drift since the preview stops before the first write. */
export async function applyRelease(previewPath, stateDirectory, { archive = [], request: transport } = {}) {
  const preview = previewSchema.parse(JSON.parse(await readFile(previewPath, "utf8")));
  const { fingerprint, ...plan } = preview;
  if (checksum(canonical(plan)) !== fingerprint) throw new Error("Preview file was changed after review");
  const target = releaseTarget(preview.target);
  if (preview.environment !== "development") throw new Error("Only a development environment can be released to by this command");
  if (preview.materials.some((item) => item.change === "conflict")) throw new Error("The preview contains conflicts; reconcile them and preview again");
  const unapproved = archive.map((id) => (id.includes(":") ? id : `inside-content:${id}`)).filter((id) => !preview.archiveProposals.includes(id));
  if (unapproved.length) throw new Error(`Archive is limited to the reviewed proposals: ${unapproved.join(", ")}`);
  const pkg = await loadPackage(preview.packagePath);
  if (pkg.id !== preview.packageId) throw new Error("Package differs from the reviewed preview");
  const current = await previewRelease(preview.packagePath, stateDirectory, { origin: target, request: transport });
  if (canonical(current.preview.expected) !== canonical(preview.expected) || canonical(current.preview.archiveProposals) !== canonical(preview.archiveProposals)) {
    throw new Error("The environment changed after the preview; preview again before releasing");
  }
  return syncLocal(preview.packagePath, stateDirectory, { origin: target, request: transport, archive });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
  const archive = args.flatMap((value, index) => (args[index - 1] === "--archive" ? [value] : []));
  const [command] = args;
  const stateDirectory = option("--state");
  if (command === "preview" && option("--package") && option("--target") && stateDirectory) {
    const { path, summary, preview } = await previewRelease(option("--package"), stateDirectory, { origin: releaseTarget(option("--target")) });
    process.stdout.write(`${JSON.stringify({ preview: path, summary, guides: preview.guides, archiveProposals: preview.archiveProposals, changes: preview.materials.filter((item) => item.change !== "unchanged") }, null, 2)}\n`);
  } else if (command === "apply" && option("--preview") && stateDirectory) {
    const report = await applyRelease(option("--preview"), stateDirectory, { archive });
    process.stdout.write(`${JSON.stringify({ applied: report.applied, unchanged: report.unchanged, archived: report.archived, guides: report.guides }, null, 2)}\n`);
  } else {
    throw new Error("Usage: pnpm authoring:release preview --package PACKAGE_JSON --target editor|stand --state STATE_DIRECTORY\n       pnpm authoring:release apply --preview PREVIEW_JSON --state STATE_DIRECTORY [--archive SOURCE_ID]...");
  }
}
