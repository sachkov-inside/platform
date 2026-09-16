import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPackage, canonical, checksum } from "./package.mjs";
import { convertMarkdown, sourceUuid } from "./markdown.mjs";
import { withJournal, applyJournaled } from "./journal.mjs";
import { parseLocalResponse, assetReceiptSchema } from "./local-boundaries.mjs";

// This adapter is deliberately tied to the isolated review gateway. It has no remote target mode.
export const reviewOrigin = "http://127.0.0.1:4396";
export async function localRequest(path, body, key) {
  const response = await fetch(`${reviewOrigin}/__local-api${path}`, {
    method: body === undefined ? "GET" : "POST", redirect: "error",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(key ? { "idempotency-key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(`${path}: ${response.status} ${JSON.stringify(result)}`), { status: response.status });
  return result;
}

export async function syncLocal(packagePath, stateDirectory, { request: transport = localRequest, defaultAccess = "membership" } = {}) {
  const request = async (path, body, key) => parseLocalResponse(path, await transport(path, body, key));
  if (!["free", "membership"].includes(defaultAccess)) throw new Error("Explicit local access must be free or membership");
  const pkg = await loadPackage(packagePath);
  const environment = await request("/authoring/import/materials/environment");
  if (environment.mode !== "development") throw new Error("Local synchronization requires a development runtime");
  return withJournal(stateDirectory, reviewOrigin, async (context) => {
    const { journal, persist } = context;
    const report = { packageId: pkg.id, applied: 0, unchanged: 0, materials: [], guides: [], notices: [...pkg.manifest.diagnostics] };
    const rows = new Map(pkg.manifest.materials.map((row) => [row.sourceId, row]));
    const sourceId = (id) => `${pkg.manifest.sourceNamespace}:${id}`;
    const source = (row) => ({ id: sourceId(row.sourceId), path: row.sourcePath, revision: checksum(canonical({ row, assets: pkg.manifest.assets.filter((asset) => [...Object.values(row.images), row.coverAssetId, ...row.artifacts.map((item) => item.assetId)].includes(asset.sourceId)) })), showInFeed: row.showInFeed });
    // Reconcile receipts before reading versions, including a crash between receipt and material cache.
    for (const entry of Object.values(journal.operations)) {
      if (entry.request?.path !== "/authoring/import/materials/apply" || entry.status === "rejected") continue;
      const body = entry.request.body;
      const previous = journal.materials[body.source.id];
      if (entry.status === "applied" && previous?.contentVersion >= entry.result.contentVersion) continue;
      const saved = await applyJournaled(context, entry.request, (operation, key) => request(operation.path, operation.body, key));
      journal.materials[body.source.id] = { materialId: saved.materialId, contentVersion: saved.contentVersion, digest: checksum(canonical({ revision: body.source.revision, metadata: body.metadata })) };
      await persist();
    }
    const guideSummary = (guide) => {
      if (guide.summary.length <= 500) return guide.summary;
      const summary = guide.summary.split(/\n\s*\n/u)[0];
      if (summary.length > 500) throw new Error(`Guide ${guide.sourceId}: first paragraph exceeds the 500 character teaser limit`);
      report.notices.push({ code: "guide_description_pending", message: "В кратком описании продукта показан первый абзац. Полное вступление сохранено в оригинале и пакете; отдельное поле ещё не подключено." });
      return summary;
    };
    const topics = await request("/authoring/collections?kind=topic");
    const topicIds = new Map(topics.map((item) => [item.slug, item.id]));
    const topicNames = { "ai-agents": "AI-агенты", "software-engineering": "Разработка ПО", "product-development": "Разработка продукта" };
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
        const target = row.links[href] ?? row.links[decodeURI(href)];
        if (target !== undefined) {
          if (!links.has(target)) throw new Error(`${row.sourcePath}: linked original is not in this selection: ${target}`);
          const fragment = new URL(href, "https://authoring.invalid").hash;
          return `${links.get(target)}${fragment}`;
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
      const current = await request("/authoring/import/guides/reserve", { sourceId: sourceId(guide.sourceId), name: guide.title, slug: guide.sourceId, summary: guideSummary(guide) });
      guides.set(guide.sourceId, current);
    }
    const currentMaterials = new Map();
    const links = new Map();
    for (const row of rows.values()) {
      const previous = journal.materials[sourceId(row.sourceId)];
      const reserved = previous ?? await request("/authoring/import/materials/reserve", { source: source(row) });
      const current = previous?.revision === source(row).revision && previous.url && previous.primaryVideoId !== undefined
        ? { materialId: previous.materialId, contentVersion: previous.contentVersion, primaryVideoId: previous.primaryVideoId, metadata: { slug: previous.url.split("/").at(-1) } }
        : await request(`/authoring/materials/${reserved.materialId}`);
      if (!current.metadata.slug) throw new Error("Source reservation did not allocate a stable local URL");
      currentMaterials.set(row.sourceId, current);
      links.set(row.sourceId, `/materials/${current.metadata.slug}`);
    }
    for (const row of rows.values()) {
      const current = currentMaterials.get(row.sourceId);
      const revision = source(row).revision;
      const previous = journal.materials[sourceId(row.sourceId)];
      const memberships = pkg.manifest.guides.filter((guide) => guide.materialIds.includes(row.sourceId)).map((guide) => guides.get(guide.sourceId).id);
      const desiredMetadata = metadata(row, memberships);
      const digest = checksum(canonical({ revision, metadata: desiredMetadata }));
      if (previous && current.contentVersion !== previous.contentVersion) throw new Error(`${row.sourcePath}: target changed; reconcile before overwriting`);
      if (previous?.digest === digest && current.contentVersion === previous.contentVersion) {
        report.unchanged++;
      } else {
        const images = new Map();
        for (const assetId of new Set(Object.values(row.images))) {
          const asset = pkg.manifest.assets.find((item) => item.sourceId === assetId);
          const key = `image:${current.materialId}:${asset.sha256}`;
          let uploaded = journal.operations[key];
          if (!uploaded) {
            const bytes = await readFile(resolve(pkg.directory, asset.path));
            if (checksum(bytes) !== asset.sha256) throw new Error("Package asset changed during synchronization");
            const form = new FormData();
            form.set("kind", "image"); form.set("declaredSize", String(bytes.length)); form.set("checksumSha256", asset.sha256);
            form.set("file", new Blob([bytes], { type: asset.mimeType }), asset.path.split("/").at(-1));
            const result = await fetch(`${reviewOrigin}/__local-api/authoring/materials/${current.materialId}/assets`, { method: "POST", headers: { "idempotency-key": key }, body: form, redirect: "error", signal: AbortSignal.timeout(30_000) });
            if (!result.ok) throw new Error(`Asset upload: ${result.status}`);
            uploaded = assetReceiptSchema.parse(await result.json()); journal.operations[key] = uploaded; await persist();
          }
          images.set(assetId, uploaded.assetId);
        }
        const command = { source: source(row), materialId: current.materialId, expectedContentVersion: current.contentVersion, publicationState: "published", metadata: desiredMetadata, body: convert(row, links, images), primaryVideoId: current.primaryVideoId, ...(current.primaryVideoId === null ? { videoChapters: [] } : { videoChapters: row.videoChapters }) };
        const saved = await applyJournaled(context, { path: "/authoring/import/materials/apply", body: command }, (operation, key) => request(operation.path, operation.body, key));
        journal.materials[sourceId(row.sourceId)] = { materialId: saved.materialId, contentVersion: saved.contentVersion, digest, url: links.get(row.sourceId) };
        await persist(); report.applied++;
      }
      Object.assign(journal.materials[sourceId(row.sourceId)], { revision, defaultAccess, primaryVideoId: current.primaryVideoId, url: links.get(row.sourceId) });
      report.materials.push({ sourceId: row.sourceId, title: row.title, url: `${reviewOrigin}${links.get(row.sourceId)}` });
      if (row.kind === "video" && current.primaryVideoId === null) report.notices.push({ code: "video_pending", path: row.sourcePath, message: "Текст перенесён; реальное видео ещё не подключено" });
      if (row.coverAssetId) report.notices.push({ code: "cover_pending", path: row.sourcePath, message: "Файл обложки сохранён в пакете; перенос обложек ещё не подключён" });
      if (row.artifacts.length) report.notices.push({ code: "artifacts_pending", path: row.sourcePath, message: "Артефакты ещё не перенесены" });
    }
    for (const guide of pkg.manifest.guides) {
      const current = guides.get(guide.sourceId);
      const order = await request(`/authoring/guides/${current.id}/order`);
      const chapters = guide.chapters.map((chapter) => ({ id: sourceUuid(`${sourceId(guide.sourceId)}:chapter:${chapter.sourceId}`), name: chapter.title, summary: chapter.summary }));
      const chapterAssignments = Object.fromEntries(guide.chapters.flatMap((chapter, index) => chapter.materialIds.map((id) => [currentMaterials.get(id).materialId, chapters[index].id])));
      const orderedMaterialIds = guide.materialIds.map((id) => currentMaterials.get(id).materialId);
      await request("/authoring/import/guides/composition", { sourceId: sourceId(guide.sourceId), seriesId: current.id, expectedOrderVersion: order.orderVersion, orderedMaterialIds, chapters, chapterAssignments });
      if (current.name !== guide.title || current.summary !== guideSummary(guide)) await request("/authoring/import/guides/update", { sourceId: sourceId(guide.sourceId), collectionId: current.id, expectedVersion: current.version, name: guide.title, summary: guideSummary(guide) });
      report.guides.push({ title: guide.title, url: `${reviewOrigin}/guides/${current.slug}`, programmeUrl: `${reviewOrigin}/guides/${current.slug}/programme`, mainMaterials: orderedMaterialIds.length, supplementaryMaterials: guide.supplementaryMaterialIds.map((id) => ({ sourceId: id, url: `${reviewOrigin}${links.get(id)}` })) });
    }
    journal.lastReport = report; await persist();
    return report;
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [packagePath, stateDirectory] = process.argv.slice(2);
  if (!packagePath || !stateDirectory) throw new Error("Usage: pnpm authoring:sync-local PACKAGE_JSON STATE_DIRECTORY");
  const report = await syncLocal(packagePath, stateDirectory);
  process.stdout.write(`${JSON.stringify({ packageId: report.packageId, applied: report.applied, unchanged: report.unchanged, guides: report.guides, notices: report.notices.length }, null, 2)}\n`);
}
