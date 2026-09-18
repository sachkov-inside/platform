import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadPackage, canonical, checksum } from "./package.mjs";
import { convertMarkdown, sourceUuid } from "./markdown.mjs";
import { withJournal, applyJournaled } from "./journal.mjs";
import { parseLocalResponse } from "./local-boundaries.mjs";
import { localTransport, loopbackOrigin, readerOriginFor, resolveLocalTarget } from "./target.mjs";
import { waitUntilReady } from "./video.mjs";

// Kept for callers of the isolated editor runtime; every target is loopback-only.
export const reviewOrigin = resolveLocalTarget("editor");
export const localRequest = localTransport(reviewOrigin);

const topicNames = { "ai-agents": "AI-агенты", "software-engineering": "Разработка ПО", "product-development": "Разработка продукта" };

// The revision covers the whole original row and the bytes of every file it references.
export function materialRevision(manifest, row) {
  return checksum(canonical({ row, assets: manifest.assets.filter((asset) => [...Object.values(row.images), row.coverAssetId, ...row.artifacts.map((item) => item.assetId)].includes(asset.sourceId)) }));
}

export const sourceKey = (manifest, id) => `${manifest.sourceNamespace}:${id}`;

/** Guides whose programme or supplementary part contains this original. */
export function productsOf(manifest, row) {
  return manifest.guides.filter((guide) => [...guide.materialIds, ...guide.supplementaryMaterialIds].includes(row.sourceId));
}

function materialDigest({ revision, metadata, primaryVideoId, videoChapters }) {
  return checksum(canonical({ revision, metadata, ...(primaryVideoId ? { primaryVideoId, videoChapters } : {}) }));
}

/** The Material state an original asks for; a changed digest is what the sync applies. */
export function desiredMaterial(manifest, row, { topicIds, guideIds, defaultAccess, primaryVideoId }) {
  const metadata = { title: row.title, summary: row.summary, access: row.access ?? defaultAccess, difficulty: row.difficulty, outcomes: row.outcomes ?? [], topicId: row.topicId === null ? null : topicIds.get(row.topicId), formatId: row.kind, tagIds: [], seriesIds: productsOf(manifest, row).map((guide) => guideIds.get(guide.sourceId)) };
  const videoChapters = primaryVideoId === null ? [] : row.videoChapters;
  return { metadata, videoChapters, digest: materialDigest({ revision: materialRevision(manifest, row), metadata, primaryVideoId, videoChapters }) };
}

const guideTeaserLimit = 500;

/** The product teaser: the whole summary when it fits, otherwise its first paragraph. */
export function guideTeaser(guide) {
  if (guide.summary.length <= guideTeaserLimit) return { teaser: guide.summary, partial: false };
  const [first] = guide.summary.split(/\n\s*\n/u);
  if (first.length > guideTeaserLimit) throw new Error(`Guide ${guide.sourceId}: first paragraph exceeds the ${String(guideTeaserLimit)} character teaser limit`);
  return { teaser: first, partial: true };
}

/**
 * Everything the source owns about a Guide besides its programme (ADR 0026). The page keeps the
 * shape Platform stores, so an absent Home card caption is not a change. A package that names no
 * address leaves the current one alone: an older package must not move a published product.
 */
export function guideDetails(guide, current) {
  // Пакет, который не называет описание или оформление, оставляет их прежними: так старый пакет не
  // стирает страницу. Снять описание можно явным `page: null` в манифесте.
  const page = guide.page === undefined ? current?.page ?? null : guide.page === null ? null : { card: guide.page.card ?? null, blocks: guide.page.blocks };
  return {
    name: guide.title.trim(),
    summary: guideTeaser(guide).teaser.trim(),
    slug: guide.slug ?? current?.slug ?? guide.sourceId,
    presentation: guide.presentation ?? current?.presentation ?? "default",
    page,
  };
}
/** Сравнение идёт с тем, что цель уже держит: журнал ничего об описании не помнит. */
export function guideDetailsMatch(current, details) {
  // Нечитаемое описание цели — всегда несовпадение: только перенос может его заменить.
  return current.pageRejected !== true
    && current.name === details.name && current.summary === details.summary && current.slug === details.slug
    && (current.presentation ?? "default") === details.presentation
    && canonical(current.page ?? null) === canonical(details.page);
}

/**
 * The whole page description is checked before the first write: Platform owns the schema, so the
 * transfer asks it instead of keeping a fourth copy of the rules.
 */
export async function validateGuidePages(manifest, send) {
  for (const guide of manifest.guides) {
    const details = guideDetails(guide);
    // Адрес проверяется только когда пакет его называет: продукт на своём адресе не должен падать
    // из-за формы чужого ключа. Новый продукт с непригодным ключом остановит reserve — он идёт до
    // записи материалов.
    const source = { presentation: details.presentation, page: details.page, ...(guide.slug === undefined ? {} : { slug: guide.slug }) };
    const path = "/authoring/import/guides/validate";
    try {
      parseLocalResponse(path, await send(path, { sourceId: sourceKey(manifest, guide.sourceId), source }));
    } catch (error) {
      throw new Error(`Product ${guide.sourceId}: Platform rejected its page description or presentation '${details.presentation}'. ${error.message}`, { cause: error });
    }
  }
}

export function guideChapters(manifest, guide) {
  return guide.chapters.map((chapter) => ({ id: sourceUuid(`${sourceKey(manifest, guide.sourceId)}:chapter:${chapter.sourceId}`), name: chapter.title, summary: chapter.summary }));
}

export function artifactFingerprint(asset, artifact, access) {
  return checksum(canonical({ sha256: asset.sha256, title: artifact.title, access }));
}

/** Artifacts a product carries, each with the Materials that declare it and the access it needs. */
export function artifactDeclarations(manifest, guide, defaultAccess) {
  const declared = new Map();
  for (const id of [...guide.materialIds, ...guide.supplementaryMaterialIds]) {
    const row = manifest.materials.find((item) => item.sourceId === id);
    for (const artifact of row.artifacts) {
      const entry = declared.get(artifact.sourceId) ?? { artifact, owners: [] };
      if (entry.artifact.assetId !== artifact.assetId || entry.artifact.title !== artifact.title) throw new Error(`${row.sourcePath}: artifact ${artifact.sourceId} differs from another declaration`);
      entry.owners.push(row);
      declared.set(artifact.sourceId, entry);
    }
  }
  for (const entry of declared.values()) {
    const accesses = entry.owners.map((row) => row.access ?? defaultAccess);
    if (accesses.includes("workshop")) throw new Error(`${entry.owners[0].sourcePath}: workshop Materials cannot carry Guide artifacts`);
    // One artifact serves every declaring Material, so it is paid when any of them is.
    entry.access = accesses.includes("membership") ? "membership" : "free";
  }
  return declared;
}

export function normalizeSourceIds(manifest, ids) {
  return ids.map((id) => (id.includes(":") ? id : sourceKey(manifest, id)));
}

// A missing original is never an instruction: previously synchronized Materials of the selected products are proposed.
export function archiveProposalKeys(journal, manifest) {
  const present = new Set(manifest.materials.map((row) => sourceKey(manifest, row.sourceId)));
  const selected = new Set(manifest.guides.map((guide) => sourceKey(manifest, guide.sourceId)));
  return Object.entries(journal.materials)
    .filter(([key, entry]) => key.startsWith(`${manifest.sourceNamespace}:`) && !present.has(key) && !entry.archived
      // Entries recorded before products were tracked belong to any product selection.
      && (entry.guideSourceIds ? entry.guideSourceIds.some((id) => selected.has(id)) : selected.size > 0))
    .map(([key]) => key);
}

export async function syncLocal(packagePath, stateDirectory, { origin = reviewOrigin, request: transport, defaultAccess = "membership", archive = [], sleep = delay, videoAttempts = 20, pinHome = false } = {}) {
  const target = loopbackOrigin(origin);
  const reader = readerOriginFor(target);
  const send = transport ?? localTransport(target);
  const request = async (path, body, key, options) => parseLocalResponse(path, await send(path, body, key, options));
  if (!["free", "membership"].includes(defaultAccess)) throw new Error("Explicit local access must be free or membership");
  const pkg = await loadPackage(packagePath);
  const environment = await request("/authoring/import/materials/environment");
  if (environment.mode !== "development") throw new Error("Local synchronization requires a development runtime");
  await validateGuidePages(pkg.manifest, send);
  return withJournal(stateDirectory, target, async (context) => {
    const { journal, persist } = context;
    journal.resources ??= {};
    const report = { packageId: pkg.id, applied: 0, unchanged: 0, materials: [], guides: [], archived: [], archiveProposals: [], notices: [...pkg.manifest.diagnostics] };
    const rows = new Map(pkg.manifest.materials.map((row) => [row.sourceId, row]));
    const assets = new Map(pkg.manifest.assets.map((asset) => [asset.sourceId, asset]));
    const sourceId = (id) => sourceKey(pkg.manifest, id);
    const source = (row) => ({ id: sourceId(row.sourceId), path: row.sourcePath, revision: materialRevision(pkg.manifest, row), showInFeed: row.showInFeed });
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
      journal.materials[body.source.id] = { ...previous, materialId: saved.materialId, contentVersion: saved.contentVersion, digest: materialDigest({ revision: body.source.revision, metadata: body.metadata, primaryVideoId: body.primaryVideoId, videoChapters: body.videoChapters }), archived: body.publicationState === "unpublished" };
      await persist();
    }

    const teasers = new Map(pkg.manifest.guides.map((guide) => [guide.sourceId, guideTeaser(guide)]));
    if ([...teasers.values()].some(({ partial }) => partial)) {
      report.notices.push({ code: "guide_description_partial", message: "Кратким описанием продукта стал первый абзац. Полное описание страницы переносится отдельными блоками ключа page." });
    }
    const topics = await request("/authoring/collections?kind=topic");
    const topicIds = new Map(topics.map((item) => [item.slug, item.id]));
    for (const id of new Set(pkg.manifest.materials.map((row) => row.topicId).filter(Boolean))) {
      if (!(id in topicNames)) throw new Error(`Topic is outside the approved dictionary: ${id}`);
      if (!topicIds.has(id)) {
        const created = await request("/authoring/collections", { kind: "topic", slug: id, name: topicNames[id], summary: "" });
        topicIds.set(id, created.id);
      }
    }
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
    const guides = new Map();
    for (const guide of pkg.manifest.guides) {
      if (!guide.complete) throw new Error("This first local programme adapter requires a complete Guide selection");
      const key = sourceId(guide.sourceId);
      try {
      const reserved = journal.guides[key];
      let current = await request("/authoring/import/guides/reserve", { sourceId: key, name: guide.title.trim(), slug: guide.slug ?? reserved?.slug ?? guide.sourceId, summary: guideTeaser(guide).teaser.trim() });
      const details = guideDetails(guide, current);
      journal.guides[key] = { ...journal.guides[key], guideId: current.id, slug: current.slug };
      // The page is checked here, before any Material is written; an unchanged product writes nothing.
      if (!guideDetailsMatch(current, details)) {
        current = await request("/authoring/import/guides/update", { sourceId: key, collectionId: current.id, expectedVersion: current.version, name: details.name, summary: details.summary, source: { slug: details.slug, presentation: details.presentation, page: details.page } });
        journal.guides[key] = { ...journal.guides[key], slug: current.slug, version: current.version };
      }
      guides.set(guide.sourceId, current);
      await persist();
      } catch (error) {
        throw new Error(`Product ${guide.sourceId}: ${error.message}`, { cause: error });
      }
    }

    // Paid Materials must belong to a product, so validation uses the reserved Guides' real identities.
    // Supplementary originals are Guide members outside chapters: the product's "Additional Materials" part.
    const guideIds = new Map([...guides].map(([id, guide]) => [id, guide.id]));
    const desired = (row, primaryVideoId) => desiredMaterial(pkg.manifest, row, { topicIds, guideIds, defaultAccess, primaryVideoId });
    // Validate every document before changing any previously correct Material; only empty Guide shells exist so far.
    for (const row of rows.values()) {
      if (journal.materials[sourceId(row.sourceId)]?.revision === source(row).revision && journal.materials[sourceId(row.sourceId)]?.defaultAccess === defaultAccess) continue;
      try {
        await request("/authoring/import/materials/validate", { source: source(row), publicationState: "published", metadata: desired(row, null).metadata, body: convert(row, placeholderLinks, placeholderImages), videoChapters: [] });
      } catch (error) { throw new Error(`${row.sourcePath}: ${error.message}`, { cause: error }); }
    }

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
      const attached = receipt?.videoId ? null : await request(`/authoring/materials/${current.materialId}/videos/attach`, { access, providerVideoId: row.video.kinescopeId });
      if (attached) { journal.resources[key] = { videoId: attached.videoId, state: attached.state }; await persist(); }
      const videoId = attached?.videoId ?? receipt.videoId;
      if ((attached?.state ?? receipt.state) !== "ready") {
        await waitUntilReady(request, videoId, { sleep, attempts: videoAttempts, label: `${row.sourcePath} (${row.video.kinescopeId})`, onState: async (video) => { journal.resources[key] = { videoId, state: video.state }; await persist(); } });
      }
      return videoId;
    };

    for (const row of rows.values()) {
      const key = sourceId(row.sourceId);
      let current = currentMaterials.get(row.sourceId);
      const revision = source(row).revision;
      const previous = journal.materials[key];
      const primaryVideoId = await attachVideo(row, current, row.access ?? defaultAccess);
      const { metadata: desiredMetadata, videoChapters, digest } = desired(row, primaryVideoId);
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
      Object.assign(journal.materials[key], { revision, defaultAccess, access: desiredMetadata.access, primaryVideoId, url: links.get(row.sourceId), guideSourceIds: productsOf(pkg.manifest, row).map((guide) => sourceId(guide.sourceId)), ...cover });
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
      // The cover route has no idempotency key: a pending marker lets a retry adopt a change the lost response hid.
      const pendingKey = `cover-pending:${current.materialId}`;
      const pending = journal.resources[pendingKey];
      journal.resources[pendingKey] = { sha256: asset.sha256, expectedCoverId: known.coverId }; await persist();
      const form = fileForm({ sourceId: sourceId(row.sourceId), expectedCoverId: known.coverId ?? "null" }, bytes, asset);
      let coverId;
      try {
        coverId = (await request(`/authoring/import/content-covers/material/${current.materialId}`, form, undefined, { method: "PUT" })).cover?.coverId ?? null;
      } catch (error) {
        // Imported covers change only through this source, so a conflict after an unfinished upload is that upload.
        if (error.status !== 409 || pending?.sha256 !== asset.sha256 || typeof error.body?.currentCoverId !== "string") throw error;
        coverId = error.body.currentCoverId;
      }
      delete journal.resources[pendingKey];
      return { coverId, coverSha256: asset.sha256 };
    }

    for (const guide of pkg.manifest.guides) {
      try {
      const current = guides.get(guide.sourceId);
      const order = await request(`/authoring/guides/${current.id}/order`);
      const chapters = guideChapters(pkg.manifest, guide);
      const chapterAssignments = Object.fromEntries(guide.chapters.flatMap((chapter, index) => chapter.materialIds.map((id) => [currentMaterials.get(id).materialId, chapters[index].id])));
      const orderedMaterialIds = [...guide.materialIds, ...guide.supplementaryMaterialIds].map((id) => currentMaterials.get(id).materialId);
      await request("/authoring/import/guides/composition", { sourceId: sourceId(guide.sourceId), seriesId: current.id, expectedOrderVersion: order.orderVersion, orderedMaterialIds, chapters, chapterAssignments });
      await syncArtifacts(guide, current);
      report.guides.push({ title: guide.title, url: `${reader}/guides/${current.slug}`, programmeUrl: `${reader}/guides/${current.slug}/programme`, mainMaterials: guide.materialIds.length, supplementaryMaterials: guide.supplementaryMaterialIds.map((id) => ({ sourceId: id, url: `${reader}${links.get(id)}` })) });
      } catch (error) {
        throw new Error(`Product ${guide.sourceId}: ${error.message}`, { cause: error });
      }
    }

    // Material artifacts become authoring-owned Guide artifacts linked back to every Material that declares them.
    async function syncArtifacts(guide, current) {
      const guideSource = sourceId(guide.sourceId);
      const declared = artifactDeclarations(pkg.manifest, guide, defaultAccess);
      for (const [artifactSourceId, { artifact, owners, access }] of declared) {
        const asset = assets.get(artifact.assetId);
        const receiptKey = `artifact:${current.id}:${sourceId(artifactSourceId)}`;
        const fingerprint = artifactFingerprint(asset, artifact, access);
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
      if (row.artifacts.length && productsOf(pkg.manifest, row).length === 0) report.notices.push({ code: "artifacts_need_guide", path: row.sourcePath, message: "Артефакты самостоятельного материала переносятся только вместе с продуктом" });
    }

    // Proposed Materials are unpublished only when named explicitly.
    const requested = new Set(normalizeSourceIds(pkg.manifest, archive));
    for (const key of archiveProposalKeys(journal, pkg.manifest)) {
      const entry = journal.materials[key];
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
    // The local product view features the transferred product on Home, like production will.
    if (pinHome) {
      if (pkg.manifest.guides.length !== 1) throw new Error("Pinning Home needs exactly one product in the package");
      const guideId = guides.get(pkg.manifest.guides[0].sourceId).id;
      const pin = await request("/authoring/home-pin");
      if (pin.seriesId !== guideId) await request("/authoring/home-pin", { seriesId: guideId, expectedVersion: pin.version }, undefined, { method: "PUT" });
      report.homePinned = guideId;
    }
    journal.lastReport = report; await persist();
    return report;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { target: { type: "string", default: "editor" }, archive: { type: "string", multiple: true, default: [] } } });
  if (positionals.length !== 2) throw new Error("Usage: pnpm authoring:sync-local PACKAGE_JSON STATE_DIRECTORY [--target editor|stand] [--archive SOURCE_ID]...");
  const [packagePath, stateDirectory] = positionals;
  const report = await syncLocal(packagePath, stateDirectory, { origin: resolveLocalTarget(values.target), archive: values.archive });
  process.stdout.write(`${JSON.stringify({ packageId: report.packageId, applied: report.applied, unchanged: report.unchanged, guides: report.guides, archived: report.archived, archiveProposals: report.archiveProposals, notices: report.notices }, null, 2)}\n`);
}
