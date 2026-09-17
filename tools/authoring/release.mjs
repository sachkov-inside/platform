import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadPackage, canonical, checksum } from "./package.mjs";
import { writeAtomic } from "./journal.mjs";
import { parseJournal, parseLocalResponse } from "./local-boundaries.mjs";
import { archiveProposalKeys, artifactDeclarations, artifactFingerprint, assertKnownPresentations, desiredMaterial, guideChapters, guideDetails, guidePageDigest, normalizeSourceIds, sourceKey, syncLocal } from "./local-sync.mjs";
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
export async function previewRelease(packagePath, stateDirectory, { origin, request: transport, defaultAccess = "membership" } = {}) {
  const target = loopbackOrigin(origin);
  const send = transport ?? localTransport(target);
  const request = async (path) => parseLocalResponse(path, await send(path));
  const pkg = await loadPackage(packagePath);
  const { manifest } = pkg;
  const environment = await request("/authoring/import/materials/environment");
  assertKnownPresentations(manifest, environment);
  const journal = await readJournal(stateDirectory, target);
  const resources = journal.resources ?? {};
  const topics = await request("/authoring/collections?kind=topic");
  const topicIds = new Map(topics.map((item) => [item.slug, item.id]));
  const guideIds = new Map(manifest.guides.flatMap((guide) => {
    const entry = journal.guides[sourceKey(manifest, guide.sourceId)];
    return entry ? [[guide.sourceId, entry.guideId]] : [];
  }));
  const assets = new Map(manifest.assets.map((asset) => [asset.sourceId, asset]));
  const materials = [];
  const expected = {};
  for (const row of manifest.materials) {
    const key = sourceKey(manifest, row.sourceId);
    const entry = journal.materials[key];
    const item = { sourceId: row.sourceId, title: row.title, access: row.access ?? defaultAccess, showInFeed: row.showInFeed, video: row.video?.kinescopeId ?? null };
    if (!entry) { materials.push({ ...item, change: "new", coverChange: row.coverAssetId !== null }); continue; }
    const current = await request(`/authoring/materials/${entry.materialId}`);
    expected[key] = current.contentVersion;
    // A named provider record that was never attached here makes the Material change on apply.
    const uploaded = resources[`source-video:${key}`];
    // Attaching the provider record of this Material's own upload returns the same Video.
    const attached = row.video === null
      ? uploaded?.videoId ?? current.primaryVideoId
      : resources[`video:${entry.materialId}:${row.video.kinescopeId}`]?.videoId
        ?? (uploaded?.providerVideoId === row.video.kinescopeId ? uploaded.videoId : `attach:${row.video.kinescopeId}`);
    const { digest } = desiredMaterial(manifest, row, { topicIds, guideIds, defaultAccess, primaryVideoId: attached });
    // A Video keeps the access it was attached with; changing a Material's access needs a new recording decision.
    const currentAccess = current.metadata.access ?? entry.access;
    const existingVideo = attached !== null && !String(attached).startsWith("attach:");
    const videoAccessConflict = existingVideo && currentAccess !== undefined && currentAccess !== item.access;
    const change = current.contentVersion !== entry.contentVersion || videoAccessConflict ? "conflict" : entry.archived ? "restore" : entry.digest !== digest ? "changed" : "unchanged";
    const coverSha = row.coverAssetId === null ? null : assets.get(row.coverAssetId).sha256;
    materials.push({
      ...item, change,
      ...(attached !== current.primaryVideoId ? { videoChange: true } : {}),
      ...(videoAccessConflict ? { conflictReason: "video_access_change" } : {}),
      ...(coverSha !== null && coverSha !== (entry.coverSha256 ?? null) ? { coverChange: true } : {}),
      ...(current.source?.showInFeed !== undefined && current.source.showInFeed !== row.showInFeed ? { feedChange: { from: current.source.showInFeed, to: row.showInFeed } } : {}),
      ...(currentAccess !== undefined && currentAccess !== item.access ? { accessChange: { from: currentAccess, to: item.access } } : {}),
    });
  }
  const guides = [];
  const currentGuides = guideIds.size === 0 ? [] : await request("/authoring/collections?kind=guide");
  for (const guide of manifest.guides) {
    const programme = [...guide.materialIds, ...guide.supplementaryMaterialIds];
    const guideId = guideIds.get(guide.sourceId);
    const artifactChanges = [...artifactDeclarations(manifest, guide, defaultAccess)]
      .filter(([artifactSourceId, { artifact, access }]) => {
        const receipt = guideId === undefined ? undefined : resources[`artifact:${guideId}:${sourceKey(manifest, artifactSourceId)}`];
        return receipt?.fingerprint !== artifactFingerprint(assets.get(artifact.assetId), artifact, access);
      })
      .map(([artifactSourceId]) => artifactSourceId);
    const details = guideDetails(guide);
    if (guideId === undefined) { guides.push({ sourceId: guide.sourceId, title: guide.title, change: "new", materials: programme.length, artifactChanges, slug: details.slug, presentation: details.presentation, page: details.page === null ? "none" : "new" }); continue; }
    const order = await request(`/authoring/guides/${guideId}/order`);
    expected[`${sourceKey(manifest, guide.sourceId)}:order`] = order.orderVersion;
    const ids = new Map(programme.map((id) => [id, journal.materials[sourceKey(manifest, id)]?.materialId]));
    const desiredOrder = programme.map((id) => ids.get(id) ?? `new:${id}`);
    const currentOrder = order.items.map((item) => item.materialId);
    const chapterOf = new Map(guide.chapters.flatMap((chapter) => chapter.materialIds.map((id) => [ids.get(id), chapter.title])));
    const currentChapters = new Map(order.chapters.map((chapter) => [chapter.id, chapter.name]));
    const stored = currentGuides.find((item) => item.id === guideId);
    const currentChapterText = new Map(order.chapters.map((chapter) => [chapter.id, canonical({ name: chapter.name, summary: chapter.summary })]));
    const chapterTextChanges = guideChapters(manifest, guide).filter((chapter) => currentChapterText.has(chapter.id) && currentChapterText.get(chapter.id) !== canonical({ name: chapter.name, summary: chapter.summary })).length;
    const entry = journal.guides[sourceKey(manifest, guide.sourceId)];
    // The page is written only by this transfer, so its last recorded digest is what Platform holds.
    const pageChange = entry.pageDigest !== guidePageDigest(guide);
    const slugChange = stored !== undefined && stored.slug !== details.slug ? { from: stored.slug, to: details.slug } : undefined;
    const presentationChange = stored !== undefined && (stored.presentation ?? "default") !== details.presentation ? { from: stored.presentation ?? "default", to: details.presentation } : undefined;
    const detailsChange = stored === undefined || stored.name !== details.name || stored.summary !== details.summary || pageChange || slugChange !== undefined || presentationChange !== undefined;
    const moved = order.items.filter((item) => (chapterOf.get(item.materialId) ?? null) !== (item.chapterId === null ? null : currentChapters.get(item.chapterId) ?? null)).length;
    guides.push({
      sourceId: guide.sourceId, title: guide.title, materials: programme.length, artifactChanges,
      change: canonical(desiredOrder) === canonical(currentOrder) && moved === 0 && chapterTextChanges === 0 ? (detailsChange ? "details" : "unchanged") : "composition",
      detailsChange, chapterTextChanges, pageChange,
      ...(slugChange ? { slugChange } : {}),
      ...(presentationChange ? { presentationChange } : {}),
      added: desiredOrder.filter((id) => !currentOrder.includes(id)).length,
      removed: currentOrder.filter((id) => !desiredOrder.includes(id)).length,
      reorderedOrRegrouped: canonical(desiredOrder.filter((id) => currentOrder.includes(id))) !== canonical(currentOrder.filter((id) => desiredOrder.includes(id))) || moved > 0,
    });
  }
  const archiveProposals = archiveProposalKeys(journal, manifest);
  const plan = { schemaVersion: 1, target, environment: environment.mode, packageId: pkg.id, packagePath: resolve(packagePath), namespace: manifest.sourceNamespace, expected, materials, guides, archiveProposals };
  const preview = { ...plan, fingerprint: checksum(canonical(plan)) };
  const summary = Object.fromEntries(["new", "changed", "restore", "unchanged", "conflict"].map((change) => [change, materials.filter((item) => item.change === change).length]));
  const directory = join(resolve(stateDirectory), "previews");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${preview.fingerprint}.json`);
  await writeAtomic(path, preview);
  return { path, preview, summary };
}

const previewSchema = z.object({
  schemaVersion: z.literal(1), target: z.string(), environment: z.string(), packageId: z.hash("sha256"), packagePath: z.string(), namespace: z.string(),
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
  const unapproved = normalizeSourceIds({ sourceNamespace: preview.namespace }, archive).filter((id) => !preview.archiveProposals.includes(id));
  if (unapproved.length) throw new Error(`Archive is limited to the reviewed proposals: ${unapproved.join(", ")}`);
  const pkg = await loadPackage(preview.packagePath);
  if (pkg.id !== preview.packageId) throw new Error("Package differs from the reviewed preview");
  // The recomputed plan must be the reviewed one: versions, local receipts and every listed change.
  const current = await previewRelease(preview.packagePath, stateDirectory, { origin: target, request: transport });
  if (current.preview.fingerprint !== fingerprint) throw new Error("The environment changed after the preview; preview again before releasing");
  return syncLocal(preview.packagePath, stateDirectory, { origin: target, request: transport, archive });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { package: { type: "string" }, target: { type: "string" }, state: { type: "string" }, preview: { type: "string" }, archive: { type: "string", multiple: true, default: [] } } });
  const [command] = positionals;
  if (command === "preview" && values.package && values.target && values.state) {
    const { path, summary, preview } = await previewRelease(values.package, values.state, { origin: releaseTarget(values.target) });
    process.stdout.write(`${JSON.stringify({ preview: path, summary, guides: preview.guides, archiveProposals: preview.archiveProposals, changes: preview.materials.filter((item) => item.change !== "unchanged") }, null, 2)}\n`);
  } else if (command === "apply" && values.preview && values.state) {
    const report = await applyRelease(values.preview, values.state, { archive: values.archive });
    process.stdout.write(`${JSON.stringify({ applied: report.applied, unchanged: report.unchanged, archived: report.archived, guides: report.guides }, null, 2)}\n`);
  } else {
    throw new Error("Usage: pnpm authoring:release preview --package PACKAGE_JSON --target editor|stand --state STATE_DIRECTORY\n       pnpm authoring:release apply --preview PREVIEW_JSON --state STATE_DIRECTORY [--archive SOURCE_ID]...");
  }
}
