import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { loadPackage, canonical, checksum } from "./package.mjs";
import { convertMarkdown, sourceUuid } from "./markdown.mjs";
import { withJournal, applyJournaled } from "./journal.mjs";
import { parseLocalResponse } from "./local-boundaries.mjs";
import { localTransport, loopbackOrigin, readerOriginFor, resolveLocalTarget } from "./target.mjs";

// Kept for callers of the isolated editor runtime; every target is loopback-only.
export const reviewOrigin = resolveLocalTarget("editor");
export const localRequest = localTransport(reviewOrigin);

const topicNames = { "ai-agents": "AI-агенты", "software-engineering": "Разработка ПО", "product-development": "Разработка продукта" };

export async function syncLocal(packagePath, stateDirectory, { origin = reviewOrigin, request: transport, defaultAccess = "membership", archive = [], sleep = delay, videoAttempts = 20 } = {}) {
  const target = loopbackOrigin(origin);
  const reader = readerOriginFor(target);
  const send = transport ?? localTransport(target);
  const request = async (path, body, key, options) => parseLocalResponse(path, await send(path, body, key, options));
  if (!["free", "membership"].includes(defaultAccess)) throw new Error("Explicit local access must be free or membership");
  const pkg = await loadPackage(packagePath);
  const environment = await request("/authoring/import/materials/environment");
  if (environment.mode !== "development") throw new Error("Local synchronization requires a development runtime");
  return withJournal(stateDirectory, target, async (context) => {
    const { journal, persist } = context;
    journal.resources ??= {};
    const report = { packageId: pkg.id, applied: 0, unchanged: 0, materials: [], guides: [], archived: [], archiveProposals: [], notices: [...pkg.manifest.diagnostics] };
    const rows = new Map(pkg.manifest.materials.map((row) => [row.sourceId, row]));
    const assets = new Map(pkg.manifest.assets.map((asset) => [asset.sourceId, asset]));
    const sourceId = (id) => `${pkg.manifest.sourceNamespace}:${id}`;
    const guideSourceIds = (row) => pkg.manifest.guides.filter((guide) => [...guide.materialIds, ...guide.supplementaryMaterialIds].includes(row.sourceId)).map((guide) => sourceId(guide.sourceId));
    const source = (row) => ({ id: sourceId(row.sourceId), path: row.sourcePath, revision: checksum(canonical({ row, assets: pkg.manifest.assets.filter((asset) => [...Object.values(row.images), row.coverAssetId, ...row.artifacts.map((item) => item.assetId)].includes(asset.sourceId)) })), showInFeed: row.showInFeed });
    const readAsset = async (asset) => {
      const bytes = await readFile(resolve(pkg.directory, asset.path));
      if (checksum(bytes) !== asset.sha256) throw new Error("Package asset changed during synchronization");
      return bytes;
    };
    const fileForm = (fields, bytes, asset) => {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.set(name, value);
      form.set("declaredSize", String(bytes.length)); form.set("checksumSha256", asset.sha256);
      form.set("file", new Blob([bytes], { type: asset.mimeType }), asset.path.split("/").at(-1));
      return form;
    };

    // Reconcile receipts before reading versions, including a crash between receipt and material cache.
    for (const entry of Object.values(journal.operations)) {
      if (entry.request?.path !== "/authoring/import/materials/apply" || entry.status === "rejected") continue;
      const body = entry.request.body;
      const previous = journal.materials[body.source.id];
      if (entry.status === "applied" && previous?.contentVersion >= entry.result.contentVersion) continue;
      const saved = await applyJournaled(context, entry.request, (operation, key) => request(operation.path, operation.body, key));
      journal.materials[body.source.id] = { ...previous, materialId: saved.materialId, contentVersion: saved.contentVersion, digest: checksum(canonical({ revision: body.source.revision, metadata: body.metadata, ...(body.primaryVideoId ? { primaryVideoId: body.primaryVideoId, videoChapters: body.videoChapters } : {}) })) };
      await persist();
    }

    const guideTeaser = (guide) => {
      if (guide.summary.length <= 500) return guide.summary;
      const paragraphs = guide.summary.split(/\n\s*\n/u);
      if (paragraphs[0].length > 500) throw new Error(`Guide ${guide.sourceId}: first paragraph exceeds the 500 character teaser limit`);
      report.notices.push({ code: "guide_description_partial", message: "Кратким описанием продукта стал первый абзац. Страница продукта оформляется в Platform; полное описание остаётся в оригинале." });
      return paragraphs[0];
    };
    const topics = await request("/authoring/collections?kind=topic");
    const topicIds = new Map(topics.map((item) => [item.slug, item.id]));
    for (const id of new Set(pkg.manifest.materials.map((row) => row.topicId).filter(Boolean))) {
      if (!(id in topicNames)) throw new Error(`Topic is outside the approved dictionary: ${id}`);
      if (!topicIds.has(id)) {
        const created = await request("/authoring/collections", { kind: "topic", slug: id, name: topicNames[id], summary: "" });
        topicIds.set(id, created.id);
      }
    }
    const metadata = (row, seriesIds) => ({ title: row.title, summary: row.summary, access: row.access ?? defaultAccess, difficulty: row.difficulty, outcomes: row.outcomes ?? [], topicId: row.topicId === null ? null : topicIds.get(row.topicId), formatId: row.kind, tagIds: [], seriesIds });
    const convert = (row, links, images) => convertMarkdown(row.markdown, {
      sourceId: sourceId(row.sourceId), sourcePath: row.sourcePath,
      link: (href) => {
        const linked = row.links[href] ?? row.links[decodeURI(href)];
        if (linked !== undefined) {
          if (!links.has(linked)) throw new Error(`${row.sourcePath}: linked original is not in this selection: ${linked}`);
          const fragment = new URL(href, "https://authoring.invalid").hash;
          return `${links.get(linked)}${fragment}`;
        }
        if (/^(https?:|mailto:|#)/u.test(href)) return href;
        throw new Error(`${row.sourcePath}: undeclared local link: ${href}`);
      },
      image: (href) => {
        const id = row.images[href] ?? row.images[decodeURI(href)];
        if (id === undefined || !images.has(id)) throw new Error(`${row.sourcePath}: unresolved image: ${href}`);
        return images.get(id);
      },
    });
    const placeholderLinks = new Map([...rows.keys()].map((id) => [id, `/materials/${id}`]));
    const placeholderImages = new Map(pkg.manifest.assets.map((asset) => [asset.sourceId, sourceUuid(asset.sourceId)]));
    // Validate every document before changing any previously correct Material.
    for (const row of rows.values()) {
      if (journal.materials[sourceId(row.sourceId)]?.revision === source(row).revision && journal.materials[sourceId(row.sourceId)]?.defaultAccess === defaultAccess) continue;
      try {
        await request("/authoring/import/materials/validate", { source: source(row), publicationState: "published", metadata: metadata(row, []), body: convert(row, placeholderLinks, placeholderImages), videoChapters: [] });
      } catch (error) { throw new Error(`${row.sourcePath}: ${error.message}`, { cause: error }); }
    }

    const guides = new Map();
    for (const guide of pkg.manifest.guides) {
      if (!guide.complete) throw new Error("This first local programme adapter requires a complete Guide selection");
      const current = await request("/authoring/import/guides/reserve", { sourceId: sourceId(guide.sourceId), name: guide.title, slug: guide.sourceId, summary: guideTeaser(guide) });
      guides.set(guide.sourceId, current);
      journal.guides[sourceId(guide.sourceId)] = { guideId: current.id, slug: current.slug };
    }
    await persist();

    const currentMaterials = new Map();
    const links = new Map();
    for (const row of rows.values()) {
      const previous = journal.materials[sourceId(row.sourceId)];
      const reserved = previous ?? await request("/authoring/import/materials/reserve", { source: source(row) });
      const cached = previous?.revision === source(row).revision && previous.url && previous.primaryVideoId !== undefined && previous.coverId !== undefined && !previous.archived;
      const current = cached
        ? { materialId: previous.materialId, contentVersion: previous.contentVersion, primaryVideoId: previous.primaryVideoId, cover: previous.coverId === null ? null : { coverId: previous.coverId }, metadata: { slug: previous.url.split("/").at(-1) } }
        : await request(`/authoring/materials/${reserved.materialId}`);
      if (!current.metadata.slug) throw new Error("Source reservation did not allocate a stable local URL");
      currentMaterials.set(row.sourceId, current);
      links.set(row.sourceId, `/materials/${current.metadata.slug}`);
    }

    // An existing provider record is attached once; the server refuses to move it to another Material.
    const attachVideo = async (row, current, access) => {
      if (row.video === null) {
        // A recording uploaded by authoring:video stays attached until the original names its provider record.
        const uploaded = journal.resources[`source-video:${sourceId(row.sourceId)}`];
        return uploaded?.videoId ?? current.primaryVideoId;
      }
      const key = `video:${current.materialId}:${row.video.kinescopeId}`;
      const receipt = journal.resources[key];
      if (receipt?.state === "ready" && receipt.videoId === current.primaryVideoId) return current.primaryVideoId;
      let video = receipt?.videoId ? null : await request(`/authoring/materials/${current.materialId}/videos/attach`, { access, providerVideoId: row.video.kinescopeId });
      if (video) { journal.resources[key] = { videoId: video.videoId, state: video.state }; await persist(); }
      const videoId = video?.videoId ?? receipt.videoId;
      for (let attempt = 0; (video?.state ?? receipt.state) !== "ready"; attempt++) {
        if (attempt >= videoAttempts) throw new Error(`${row.sourcePath}: video ${row.video.kinescopeId} is not ready yet; rerun the same commit later`);
        if (attempt > 0) await sleep(3000);
        video = await request(`/authoring/videos/${videoId}/reconcile`, {}, undefined, { method: "POST" });
        journal.resources[key] = { videoId, state: video.state }; await persist();
        if (video.state === "failed" || video.state.startsWith("delet")) throw new Error(`${row.sourcePath}: provider video ${row.video.kinescopeId} is ${video.state}`);
      }
      return videoId;
    };

    for (const row of rows.values()) {
      const key = sourceId(row.sourceId);
      let current = currentMaterials.get(row.sourceId);
      const revision = source(row).revision;
      const previous = journal.materials[key];
      const memberships = pkg.manifest.guides.filter((guide) => guide.materialIds.includes(row.sourceId)).map((guide) => guides.get(guide.sourceId).id);
      const desiredMetadata = metadata(row, memberships);
      const primaryVideoId = await attachVideo(row, current, desiredMetadata.access);
      const videoChapters = primaryVideoId === null ? [] : row.videoChapters;
      const digest = checksum(canonical({ revision, metadata: desiredMetadata, ...(primaryVideoId ? { primaryVideoId, videoChapters } : {}) }));
      if (previous && current.contentVersion !== previous.contentVersion) throw new Error(`${row.sourcePath}: target changed; reconcile before overwriting`);
      if (previous?.digest === digest && current.contentVersion === previous.contentVersion && !previous.archived) {
        report.unchanged++;
      } else {
        const images = new Map();
        for (const assetId of new Set(Object.values(row.images))) {
          const asset = assets.get(assetId);
          const imageKey = `image:${current.materialId}:${asset.sha256}`;
          let uploaded = journal.operations[imageKey];
          if (!uploaded) {
            const bytes = await readAsset(asset);
            uploaded = await request(`/authoring/materials/${current.materialId}/assets`, fileForm({ kind: "image" }, bytes, asset), imageKey);
            journal.operations[imageKey] = uploaded; await persist();
          }
          images.set(assetId, uploaded.assetId);
        }
        const command = { source: source(row), materialId: current.materialId, expectedContentVersion: current.contentVersion, publicationState: "published", metadata: desiredMetadata, body: convert(row, links, images), primaryVideoId, videoChapters };
        const saved = await applyJournaled(context, { path: "/authoring/import/materials/apply", body: command }, (operation, operationKey) => request(operation.path, operation.body, operationKey));
        journal.materials[key] = { ...previous, materialId: saved.materialId, contentVersion: saved.contentVersion, digest, url: links.get(row.sourceId), archived: false };
        current = { ...current, contentVersion: saved.contentVersion };
        await persist(); report.applied++;
      }
      const cover = await syncCover(row, current, journal.materials[key]);
      Object.assign(journal.materials[key], { revision, defaultAccess, access: desiredMetadata.access, primaryVideoId, url: links.get(row.sourceId), guideSourceIds: guideSourceIds(row), ...cover });
      await persist();
      report.materials.push({ sourceId: row.sourceId, title: row.title, url: `${reader}${links.get(row.sourceId)}` });
      if (row.kind === "video" && primaryVideoId === null) report.notices.push({ code: "video_pending", path: row.sourcePath, message: "Текст перенесён; запись видео ещё не привязана в оригинале" });
    }

    async function syncCover(row, current, entry) {
      const known = { coverId: entry.coverId ?? current.cover?.coverId ?? null, coverSha256: entry.coverSha256 ?? null };
      if (row.coverAssetId === null) {
        if (known.coverSha256 !== null) report.notices.push({ code: "cover_removal_pending", path: row.sourcePath, message: "Обложка убрана из оригинала; снимите её в Platform вручную" });
        return known;
      }
      const asset = assets.get(row.coverAssetId);
      if (known.coverSha256 === asset.sha256) return known;
      const bytes = await readAsset(asset);
      const form = fileForm({ sourceId: sourceId(row.sourceId), expectedCoverId: known.coverId ?? "null" }, bytes, asset);
      const changed = await request(`/authoring/import/content-covers/material/${current.materialId}`, form, undefined, { method: "PUT" });
      return { coverId: changed.cover?.coverId ?? null, coverSha256: asset.sha256 };
    }

    for (const guide of pkg.manifest.guides) {
      const current = guides.get(guide.sourceId);
      const order = await request(`/authoring/guides/${current.id}/order`);
      const chapters = guide.chapters.map((chapter) => ({ id: sourceUuid(`${sourceId(guide.sourceId)}:chapter:${chapter.sourceId}`), name: chapter.title, summary: chapter.summary }));
      const chapterAssignments = Object.fromEntries(guide.chapters.flatMap((chapter, index) => chapter.materialIds.map((id) => [currentMaterials.get(id).materialId, chapters[index].id])));
      const orderedMaterialIds = guide.materialIds.map((id) => currentMaterials.get(id).materialId);
      await request("/authoring/import/guides/composition", { sourceId: sourceId(guide.sourceId), seriesId: current.id, expectedOrderVersion: order.orderVersion, orderedMaterialIds, chapters, chapterAssignments });
      if (current.name !== guide.title || current.summary !== guideTeaser(guide)) {
        await request("/authoring/import/guides/update", { sourceId: sourceId(guide.sourceId), collectionId: current.id, expectedVersion: current.version, name: guide.title, summary: guideTeaser(guide) });
      }
      await syncArtifacts(guide, current);
      report.guides.push({ title: guide.title, url: `${reader}/guides/${current.slug}`, programmeUrl: `${reader}/guides/${current.slug}/programme`, mainMaterials: orderedMaterialIds.length, supplementaryMaterials: guide.supplementaryMaterialIds.map((id) => ({ sourceId: id, url: `${reader}${links.get(id)}` })) });
    }

    // Material artifacts become authoring-owned Guide artifacts linked back to every Material that declares them.
    async function syncArtifacts(guide, current) {
      const guideSource = sourceId(guide.sourceId);
      const declared = new Map();
      for (const id of [...guide.materialIds, ...guide.supplementaryMaterialIds]) {
        const row = rows.get(id);
        for (const artifact of row.artifacts) {
          const entry = declared.get(artifact.sourceId) ?? { artifact, rows: [] };
          if (entry.artifact.assetId !== artifact.assetId || entry.artifact.title !== artifact.title) throw new Error(`${row.sourcePath}: artifact ${artifact.sourceId} differs from another declaration`);
          entry.rows.push(row);
          declared.set(artifact.sourceId, entry);
        }
      }
      for (const [artifactSourceId, { artifact, rows: owners }] of declared) {
        const accesses = owners.map((row) => row.access ?? defaultAccess);
        if (accesses.includes("workshop")) throw new Error(`${owners[0].sourcePath}: workshop Materials cannot carry Guide artifacts`);
        const access = accesses.includes("membership") ? "membership" : "free";
        const asset = assets.get(artifact.assetId);
        const receiptKey = `artifact:${current.id}:${sourceId(artifactSourceId)}`;
        const fingerprint = checksum(canonical({ sha256: asset.sha256, title: artifact.title, access }));
        let receipt = journal.resources[receiptKey];
        if (receipt?.fingerprint !== fingerprint) {
          const bytes = await readAsset(asset);
          const outcome = await request(`/authoring/import/guides/${current.id}/artifacts`, fileForm({ guideSourceId: guideSource, sourceId: sourceId(artifactSourceId), title: artifact.title, purpose: "", access }, bytes, asset));
          if (outcome.outcome === "diverged") {
            report.notices.push({ code: "artifact_diverged", path: owners[0].sourcePath, message: `Артефакт «${artifact.title}» изменён в Platform; импорт его не перезаписал` });
          }
          receipt = { artifactId: outcome.artifactId, fingerprint, materialIds: receipt?.artifactId === outcome.artifactId ? receipt.materialIds : null };
          journal.resources[receiptKey] = receipt; await persist();
        }
        const materialIds = owners.map((row) => currentMaterials.get(row.sourceId).materialId).sort();
        if (canonical(receipt.materialIds) !== canonical(materialIds)) {
          await request(`/authoring/guide-artifacts/${receipt.artifactId}/materials`, { materialIds }, undefined, { method: "PUT" });
          journal.resources[receiptKey] = { ...receipt, materialIds }; await persist();
        }
      }
      const placed = await request(`/authoring/guides/${current.id}/artifacts`);
      const expected = new Set([...declared.keys()].map(sourceId));
      for (const artifact of placed.artifacts) {
        if (artifact.origin === "authoring" && !expected.has(artifact.sourceId)) {
          report.notices.push({ code: "artifact_missing", message: `Артефакт «${artifact.title}» больше не объявлен в оригиналах; уберите его из продукта в Platform, если он не нужен` });
        }
      }
    }
    for (const row of rows.values()) {
      if (row.artifacts.length && guideSourceIds(row).length === 0) report.notices.push({ code: "artifacts_need_guide", path: row.sourcePath, message: "Артефакты самостоятельного материала переносятся только вместе с продуктом" });
    }

    // A missing original is never an instruction: it is proposed, and unpublished only when named explicitly.
    const selectedGuides = new Set(pkg.manifest.guides.map((guide) => sourceId(guide.sourceId)));
    const requested = new Set(archive.map((id) => (id.includes(":") ? id : sourceId(id))));
    for (const [key, entry] of Object.entries(journal.materials)) {
      if (!key.startsWith(`${pkg.manifest.sourceNamespace}:`) || rows.has(key.slice(pkg.manifest.sourceNamespace.length + 1)) || entry.archived) continue;
      if (entry.guideSourceIds && !entry.guideSourceIds.some((id) => selectedGuides.has(id))) continue;
      if (!requested.has(key)) {
        report.archiveProposals.push({ sourceId: key, url: entry.url ? `${reader}${entry.url}` : null });
        continue;
      }
      requested.delete(key);
      const last = Object.values(journal.operations)
        .filter((operation) => operation.status === "applied" && operation.request?.path === "/authoring/import/materials/apply" && operation.request.body.source.id === key)
        .sort((left, right) => right.result.contentVersion - left.result.contentVersion)[0];
      if (!last) throw new Error(`${key}: no applied original is recorded; archive it in Platform instead`);
      const body = last.request.body;
      const command = { ...body, expectedContentVersion: entry.contentVersion, publicationState: "unpublished", metadata: { ...body.metadata, seriesIds: [] } };
      const saved = await applyJournaled(context, { path: "/authoring/import/materials/apply", body: command }, (operation, operationKey) => request(operation.path, operation.body, operationKey));
      Object.assign(entry, { contentVersion: saved.contentVersion, archived: true });
      await persist();
      report.archived.push({ sourceId: key });
    }
    if (requested.size > 0) throw new Error(`Archive request names Materials that are still in the package or were never synchronized: ${[...requested].join(", ")}`);
    if (report.archiveProposals.length) report.notices.push({ code: "archive_proposed", message: `Оригиналы пропали для ${report.archiveProposals.length} материалов; повторите синхронизацию с --archive, если их нужно снять` });
    journal.lastReport = report; await persist();
    return report;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const archive = [];
  let targetName = "editor";
  const positional = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--archive") archive.push(args[++index]);
    else if (args[index] === "--target") targetName = args[++index];
    else positional.push(args[index]);
  }
  const [packagePath, stateDirectory] = positional;
  if (!packagePath || !stateDirectory || positional.length > 2 || archive.includes(undefined)) throw new Error("Usage: pnpm authoring:sync-local PACKAGE_JSON STATE_DIRECTORY [--target editor|stand] [--archive SOURCE_ID]...");
  const report = await syncLocal(packagePath, stateDirectory, { origin: resolveLocalTarget(targetName), archive });
  process.stdout.write(`${JSON.stringify({ packageId: report.packageId, applied: report.applied, unchanged: report.unchanged, guides: report.guides, archived: report.archived, archiveProposals: report.archiveProposals, notices: report.notices }, null, 2)}\n`);
}
