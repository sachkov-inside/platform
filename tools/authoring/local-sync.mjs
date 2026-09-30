// @ts-check
import { imageUpload } from "./image-upload.mjs";
import {
  practicesFollowLessons,
  validateSourcePractices,
  replayPracticeImports,
  syncSourcePractices,
} from "./practice-import.mjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  loadPackage,
  canonical,
  checksum,
  materialRevision,
  guideShellScope,
  isGuideShell,
} from "./package.mjs";
import { convertMarkdown, sourceUuid } from "./markdown.mjs";
import { withJournal, applyJournaled } from "./journal.mjs";
import {
  artifactReceiptSchema,
  assetReceiptSchema,
  attachedVideoReceiptSchema,
  isJournalOperation,
  materialApplyRequest,
  materialReceiptSchema,
  parseLocalResponse,
  parseReceipt,
  pendingCoverReceiptSchema,
  sourceVideoReceiptSchema,
} from "./local-boundaries.mjs";
import {
  authoringTarget,
  localTransport,
  resolveLocalTarget,
  transportFor,
  failureBodyField,
  failureStatus,
} from "./target.mjs";
import { waitUntilReady } from "./video.mjs";

// Kept for callers of the isolated editor runtime; every target is loopback-only.
export const reviewOrigin = resolveLocalTarget("editor");
export const localRequest = localTransport(reviewOrigin);

/**
 * @typedef {import("./package.mjs").Manifest} Manifest
 * @typedef {import("./package.mjs").ManifestMaterial} ManifestMaterial
 * @typedef {import("./package.mjs").ManifestGuide} ManifestGuide
 * @typedef {import("./package.mjs").ManifestAsset} ManifestAsset
 * @typedef {ManifestMaterial["artifacts"][number]} ManifestArtifact
 * @typedef {import("./local-boundaries.mjs").StoredGuide} StoredGuide
 * @typedef {import("./local-boundaries.mjs").LocalRequest} LocalRequest
 * @typedef {import("./journal.mjs").Journal} Journal
 * @typedef {"free" | "membership"} DefaultAccess
 * @typedef {{ code: string; message: string; path?: string; line?: number }} SyncNotice
 * @typedef {object} SyncReport
 * @property {string} packageId
 * @property {number} applied
 * @property {number} unchanged
 * @property {{ sourceId: string; title: string; url: string; publicationState: DesiredPublication }[]} materials
 * @property {{
 *   title: string;
 *   url: string;
 *   programmeUrl: string;
 *   mainMaterials: number;
 *   supplementaryMaterials: { sourceId: string; url: string }[];
 * }[]} guides
 * @property {{ sourceId: string }[]} archived
 * @property {{ sourceId: string; url: string | null }[]} archiveProposals
 * @property {SyncNotice[]} notices
 * @property {string} [homePinned]
 * @property {"guide-shell"} [scope]
 * @typedef {object} SyncOptions
 * @property {string} [origin]
 * @property {import("./target.mjs").LocalTransport | undefined} [request]
 * @property {DefaultAccess} [defaultAccess]
 * @property {string[]} [archive]
 * @property {(milliseconds: number) => Promise<unknown>} [sleep]
 * @property {number} [videoAttempts]
 * @property {boolean} [pinHome]
 * @property {PublishSelection} [publish]
 * @property {import("./target.mjs").AccessToken | undefined} [accessToken] The owner's session for a trusted target.
 * @property {boolean} [reviewed] Set only by an exact release apply; a trusted target requires it.
 * @typedef {import("./local-boundaries.mjs").PublishSelection} PublishSelection
 * @typedef {import("./local-boundaries.mjs").PublicationState} PublicationState
 * @typedef {"draft" | "published"} DesiredPublication The only states an import asks for.
 */

/**
 * The value a map holds for a key the synchronization put there earlier.
 *
 * @template K, V
 * @param {Map<K, V>} map
 * @param {K} key
 * @returns {V}
 */
export function valueAt(map, key) {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Unknown key: ${String(key)}`);
  return value;
}

/** @type {Record<string, string>} */
const topicNames = {
  "ai-agents": "AI-агенты",
  "software-engineering": "Разработка ПО",
  "product-development": "Разработка продукта",
};

export { materialRevision } from "./package.mjs";

/**
 * @param {Pick<Manifest, "sourceNamespace">} manifest
 * @param {string} id
 */
export const sourceKey = (manifest, id) => `${manifest.sourceNamespace}:${id}`;

/**
 * Guides whose programme or supplementary part contains this original.
 *
 * @param {Manifest} manifest
 * @param {ManifestMaterial} row
 */
export function productsOf(manifest, row) {
  return manifest.guides.filter((guide) =>
    [...guide.materialIds, ...guide.supplementaryMaterialIds].includes(
      row.sourceId,
    ),
  );
}

/**
 * A published state keeps the digest older journals recorded; any other state changes it.
 *
 * @param {{
 *   revision: string;
 *   metadata: unknown;
 *   primaryVideoId: string | null;
 *   videoChapters: unknown;
 *   publicationState: PublicationState;
 * }} material
 */
function materialDigest({
  revision,
  metadata,
  primaryVideoId,
  videoChapters,
  publicationState,
}) {
  return checksum(
    canonical({
      revision,
      metadata,
      ...(primaryVideoId ? { primaryVideoId, videoChapters } : {}),
      ...(publicationState === "published" ? {} : { publicationState }),
    }),
  );
}

/**
 * The publication an original asks for (#804): only an explicit owner selection publishes it; an
 * editorial stage or missing access never does.
 *
 * @param {Pick<Manifest, "sourceNamespace" | "materials">} manifest
 * @param {PublishSelection} publish
 * @returns {(sourceKey: string) => DesiredPublication}
 */
export function publicationPolicy(manifest, publish) {
  if (publish === "all") return () => "published";
  const selected = new Set(normalizeSourceIds(manifest, publish));
  const present = new Set(
    manifest.materials.map((row) => sourceKey(manifest, row.sourceId)),
  );
  const unknown = [...selected].filter((id) => !present.has(id));
  if (unknown.length)
    throw new Error(
      `Publication names originals outside this package: ${unknown.join(", ")}`,
    );
  return (key) => (selected.has(key) ? "published" : "draft");
}

/**
 * The state the target holds; journals written before #804 recorded only archival.
 *
 * @param {{ publicationState?: PublicationState | undefined; archived?: boolean | undefined }} entry
 * @returns {PublicationState}
 */
export function recordedPublication(entry) {
  return (
    entry.publicationState ?? (entry.archived ? "unpublished" : "published")
  );
}

/**
 * What the target holds: its own answer when read, otherwise the journal.
 *
 * @param {PublicationState | undefined} reported
 * @param {Parameters<typeof recordedPublication>[0] | undefined} entry
 */
export const targetPublication = (reported, entry) =>
  reported ?? recordedPublication(entry ?? {});

/**
 * A private import never takes back or replaces what readers already see. Platform itself never
 * moves a published or unpublished Material back to draft.
 *
 * @param {ManifestMaterial} row
 * @param {PublicationState} current
 * @param {DesiredPublication} desired
 * @returns {{ code: "target_not_draft"; message: string } | undefined}
 */
export function publicationConflict(row, current, desired) {
  return desired === "draft" && current !== "draft"
    ? {
        code: "target_not_draft",
        message: `${row.sourcePath}: the Material is already ${current} in Platform; a private import neither unpublishes it nor replaces its public body. Approve its publication explicitly or leave it out of this import`,
      }
    : undefined;
}

/**
 * The Material state an original asks for; a changed digest is what the sync applies.
 *
 * @param {Manifest} manifest
 * @param {ManifestMaterial} row
 * @param {{
 *   topicIds: Map<string, string>;
 *   guideIds: Map<string, string>;
 *   defaultAccess: DefaultAccess;
 *   primaryVideoId: string | null;
 *   publicationState: DesiredPublication;
 * }} targets
 */
export function desiredMaterial(
  manifest,
  row,
  { topicIds, guideIds, defaultAccess, primaryVideoId, publicationState },
) {
  const metadata = {
    title: row.title,
    summary: row.summary,
    access: row.access ?? defaultAccess,
    difficulty: row.difficulty,
    outcomes: row.outcomes ?? [],
    topicId: row.topicId === null ? null : topicIds.get(row.topicId),
    formatId: row.kind,
    tagIds: [],
    seriesIds: productsOf(manifest, row).map((guide) =>
      guideIds.get(guide.sourceId),
    ),
  };
  const videoChapters = primaryVideoId === null ? [] : row.videoChapters;
  return {
    metadata,
    videoChapters,
    digest: materialDigest({
      revision: materialRevision(manifest, row),
      metadata,
      primaryVideoId,
      videoChapters,
      publicationState,
    }),
  };
}

const guideTeaserLimit = 500;

/**
 * The product teaser: the whole summary when it fits, otherwise its first paragraph.
 *
 * @param {Pick<ManifestGuide, "sourceId" | "summary">} guide
 */
export function guideTeaser(guide) {
  if (guide.summary.length <= guideTeaserLimit)
    return { teaser: guide.summary, partial: false };
  const [first = ""] = guide.summary.split(/\n\s*\n/u);
  if (first.length > guideTeaserLimit)
    throw new Error(
      `Guide ${guide.sourceId}: first paragraph exceeds the ${String(guideTeaserLimit)} character teaser limit`,
    );
  return { teaser: first, partial: true };
}

/**
 * Everything the source owns about a Guide besides its programme (ADR 0026). The page keeps the
 * shape Platform stores, so an absent Home card caption is not a change. A package that names no
 * address leaves the current one alone: an older package must not move a published product.
 *
 * @param {ManifestGuide} guide
 * @param {StoredGuide} [current]
 */
export function guideDetails(guide, current) {
  // Пакет, который не называет описание или оформление, оставляет их прежними: так старый пакет не
  // стирает страницу. Снять описание можно явным `page: null` в манифесте.
  const page =
    guide.page === undefined
      ? (current?.page ?? null)
      : guide.page === null
        ? null
        : { card: guide.page.card ?? null, blocks: guide.page.blocks };
  return {
    name: guide.title.trim(),
    summary: guideTeaser(guide).teaser.trim(),
    slug: guide.slug ?? current?.slug ?? guide.sourceId,
    presentation: guide.presentation ?? current?.presentation ?? "default",
    page,
  };
}
/**
 * Сравнение идёт с тем, что цель уже держит: журнал ничего об описании не помнит.
 *
 * @param {StoredGuide} current
 * @param {ReturnType<typeof guideDetails>} details
 */
export function guideDetailsMatch(current, details) {
  // Нечитаемое описание цели — всегда несовпадение: только перенос может его заменить.
  return (
    current.pageRejected !== true &&
    current.name === details.name &&
    current.summary === details.summary &&
    current.slug === details.slug &&
    (current.presentation ?? "default") === details.presentation &&
    canonical(current.page ?? null) === canonical(details.page)
  );
}

/**
 * The whole page description is checked before the first write: Platform owns the schema, so the
 * transfer asks it instead of keeping a fourth copy of the rules.
 *
 * @param {Manifest} manifest
 * @param {import("./target.mjs").LocalTransport} send
 */
export async function validateGuidePages(manifest, send) {
  for (const guide of manifest.guides) {
    const details = guideDetails(guide);
    // Адрес проверяется только когда пакет его называет: продукт на своём адресе не должен падать
    // из-за формы чужого ключа. Новый продукт с непригодным ключом остановит reserve — он идёт до
    // записи материалов.
    const source = {
      presentation: details.presentation,
      page: details.page,
      ...(guide.slug === undefined ? {} : { slug: guide.slug }),
    };
    const path = "/authoring/import/guides/validate";
    try {
      parseLocalResponse(
        path,
        await send(path, {
          sourceId: sourceKey(manifest, guide.sourceId),
          source,
        }),
      );
    } catch (error) {
      throw new Error(
        `Product ${guide.sourceId}: Platform rejected its page description or presentation '${details.presentation}'. ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {Manifest} manifest
 * @param {ManifestGuide} guide
 */
export function guideChapters(manifest, guide) {
  return guide.chapters.map((chapter) => ({
    id: sourceUuid(
      `${sourceKey(manifest, guide.sourceId)}:chapter:${chapter.sourceId}`,
    ),
    name: chapter.title,
    summary: chapter.summary,
  }));
}

/**
 * The composition a Guide shell release sends: the package's chapter list over the Materials the
 * target already holds, in their current order and chapters. A placed Material whose chapter the
 * package drops would lose its placement, so that shell is refused before any write.
 *
 * @param {Manifest} manifest
 * @param {ManifestGuide} guide
 * @param {{ items: { materialId: string; chapterId: string | null }[] }} order
 */
export function guideShellComposition(manifest, guide, order) {
  const chapters = guideChapters(manifest, guide);
  const ids = new Set(chapters.map((chapter) => chapter.id));
  const ungrouped = order.items.filter(
    (item) => item.chapterId !== null && !ids.has(item.chapterId),
  ).length;
  if (ungrouped > 0)
    throw new Error(
      `Product ${guide.sourceId}: the Guide shell drops chapters that hold ${String(ungrouped)} Materials; move them in Platform or keep those chapters`,
    );
  return {
    chapters,
    orderedMaterialIds: order.items.map((item) => item.materialId),
  };
}

/**
 * Journaled writes whose outcome is still unknown; only a sync of their own package resumes them.
 *
 * @param {Pick<Journal, "operations">} journal
 */
export const pendingOperations = (journal) =>
  Object.values(journal.operations).filter(
    (entry) => isJournalOperation(entry) && entry.status === "pending",
  ).length;

/**
 * @param {ManifestAsset} asset
 * @param {ManifestArtifact} artifact
 * @param {DefaultAccess} access
 */
export function artifactFingerprint(asset, artifact, access) {
  return checksum(
    canonical({ sha256: asset.sha256, title: artifact.title, access }),
  );
}

/**
 * Artifacts a product carries, each with the Materials that declare it and the access it needs.
 *
 * @param {Manifest} manifest
 * @param {ManifestGuide} guide
 * @param {DefaultAccess} defaultAccess
 */
export function artifactDeclarations(manifest, guide, defaultAccess) {
  /**
   * The access starts free and is raised below once every declaring Material is known.
   *
   * @type {Map<
   *   string,
   *   { artifact: ManifestArtifact; owners: ManifestMaterial[]; access: DefaultAccess }
   * >}
   */
  const declared = new Map();
  for (const id of [...guide.materialIds, ...guide.supplementaryMaterialIds]) {
    const row = manifest.materials.find((item) => item.sourceId === id);
    if (row === undefined)
      throw new Error(`Guide ${guide.sourceId} names a missing Material ${id}`);
    for (const artifact of row.artifacts) {
      const entry = declared.get(artifact.sourceId) ?? {
        artifact,
        owners: [],
        access: "free",
      };
      if (
        entry.artifact.assetId !== artifact.assetId ||
        entry.artifact.title !== artifact.title
      )
        throw new Error(
          `${row.sourcePath}: artifact ${artifact.sourceId} differs from another declaration`,
        );
      entry.owners.push(row);
      declared.set(artifact.sourceId, entry);
    }
  }
  for (const entry of declared.values()) {
    const accesses = entry.owners.map((row) => row.access ?? defaultAccess);
    if (accesses.includes("workshop"))
      throw new Error(
        `${entry.owners[0]?.sourcePath ?? entry.artifact.sourceId}: workshop Materials cannot carry Guide artifacts`,
      );
    // One artifact serves every declaring Material, so it is paid when any of them is.
    entry.access = accesses.includes("membership") ? "membership" : "free";
  }
  return declared;
}

/**
 * @param {Pick<Manifest, "sourceNamespace">} manifest
 * @param {string[]} ids
 */
export function normalizeSourceIds(manifest, ids) {
  return ids.map((id) => (id.includes(":") ? id : sourceKey(manifest, id)));
}

/**
 * A missing original is never an instruction: previously synchronized Materials of the selected
 * products are proposed.
 *
 * @param {Pick<Journal, "materials">} journal
 * @param {Manifest} manifest
 */
export function archiveProposalKeys(journal, manifest) {
  // A Guide shell names no Material, so its absent Materials say nothing about removal.
  if (isGuideShell(manifest)) return [];
  const present = new Set(
    manifest.materials.map((row) => sourceKey(manifest, row.sourceId)),
  );
  const selected = new Set(
    manifest.guides.map((guide) => sourceKey(manifest, guide.sourceId)),
  );
  return Object.entries(journal.materials)
    .filter(
      ([key, entry]) =>
        key.startsWith(`${manifest.sourceNamespace}:`) &&
        !present.has(key) &&
        !entry.archived &&
        // A private draft was never public, so a missing original has nothing to withdraw.
        entry.publicationState !== "draft" &&
        // Entries recorded before products were tracked belong to any product selection.
        (entry.guideSourceIds
          ? entry.guideSourceIds.some((id) => selected.has(id))
          : selected.size > 0),
    )
    .map(([key]) => key);
}

/**
 * @param {string} packagePath
 * @param {string} stateDirectory
 * @param {SyncOptions} [options]
 */
export async function syncLocal(
  packagePath,
  stateDirectory,
  {
    origin = reviewOrigin,
    request: transport,
    defaultAccess = "membership",
    archive = [],
    sleep = delay,
    videoAttempts = 20,
    pinHome = false,
    publish = [],
    accessToken,
    reviewed = false,
  } = {},
) {
  const target = authoringTarget(origin);
  // A trusted remote target changes only through an exactly reviewed preview (#805).
  if (target.kind === "trusted" && !reviewed)
    throw new Error(
      `Target ${target.name} is released only through pnpm authoring:release preview and apply`,
    );
  const reader = target.reader;
  const send = transport ?? transportFor(target, accessToken);
  /** @type {LocalRequest} */
  const request = async (path, body, key, options) =>
    parseLocalResponse(path, await send(path, body, key, options));
  if (!["free", "membership"].includes(defaultAccess))
    throw new Error("Explicit local access must be free or membership");
  const pkg = await loadPackage(packagePath);
  const shell = isGuideShell(pkg.manifest);
  if (shell && archive.length)
    throw new Error("A Guide shell release never archives Materials");
  const environment = await request("/authoring/import/materials/environment");
  if (environment.mode !== target.environment)
    throw new Error(
      `Target ${target.id} reports a ${environment.mode} runtime; expected ${target.environment}`,
    );
  const publicationOfKey = publicationPolicy(pkg.manifest, publish);
  /** @param {Pick<ManifestMaterial, "sourceId">} row */
  const publicationOf = (row) =>
    publicationOfKey(sourceKey(pkg.manifest, row.sourceId));
  const manifest = practicesFollowLessons(pkg.manifest, publicationOfKey);
  await validateGuidePages(pkg.manifest, send);
  await validateSourcePractices(manifest, request);
  return withJournal(stateDirectory, target.id, async (context) => {
    const { journal, persist } = context;
    const resources = (journal.resources ??= {});
    /** @type {SyncReport} */
    const report = {
      packageId: pkg.id,
      applied: 0,
      unchanged: 0,
      materials: [],
      guides: [],
      archived: [],
      archiveProposals: [],
      notices: [...pkg.manifest.diagnostics],
      ...(shell ? { scope: guideShellScope.value } : {}),
    };
    const rows = new Map(
      pkg.manifest.materials.map((row) => [row.sourceId, row]),
    );
    const assets = new Map(
      pkg.manifest.assets.map((asset) => [asset.sourceId, asset]),
    );
    /** @param {string} id */
    const sourceId = (id) => sourceKey(pkg.manifest, id);
    /** @param {ManifestMaterial} row */
    const source = (row) => ({
      id: sourceId(row.sourceId),
      path: row.sourcePath,
      revision: materialRevision(pkg.manifest, row),
      showInFeed: row.showInFeed,
    });
    /** @param {ManifestAsset} asset */
    const readAsset = async (asset) => {
      const bytes = await readFile(resolve(pkg.directory, asset.path));
      if (checksum(bytes) !== asset.sha256)
        throw new Error("Package asset changed during synchronization");
      return bytes;
    };
    /**
     * @param {Record<string, string>} fields
     * @param {Buffer<ArrayBuffer>} bytes
     * @param {ManifestAsset} asset
     */
    const fileForm = (fields, bytes, asset) => {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.set(name, value);
      form.set("declaredSize", String(bytes.length));
      form.set("checksumSha256", asset.sha256);
      form.set(
        "file",
        new Blob([bytes], { type: asset.mimeType }),
        asset.path.split("/").at(-1),
      );
      return form;
    };

    // Reconcile receipts before reading versions, including a crash between receipt and material cache.
    // A Guide shell writes no Material; an interrupted Material sync resumes with its own package.
    for (const entry of shell ? [] : Object.values(journal.operations)) {
      const operation = isJournalOperation(entry)
        ? materialApplyRequest(entry.request)
        : undefined;
      if (
        !isJournalOperation(entry) ||
        operation === undefined ||
        entry.status === "rejected"
      )
        continue;
      const body = operation.body;
      const previous = journal.materials[body.source.id];
      if (
        entry.status === "pending" &&
        body.publicationState === "published" &&
        publicationOfKey(body.source.id) !== "published"
      )
        throw new Error(
          `${body.source.path}: an interrupted transfer was publishing this Material; repeat it with the same publication approval`,
        );
      if (
        entry.status === "applied" &&
        previous !== undefined &&
        previous.contentVersion >=
          materialReceiptSchema.parse(entry.result).contentVersion
      )
        continue;
      const saved = materialReceiptSchema.parse(
        await applyJournaled(context, operation, (replayed, key) =>
          request(replayed.path, replayed.body, key),
        ),
      );
      journal.materials[body.source.id] = {
        ...previous,
        materialId: saved.materialId,
        contentVersion: saved.contentVersion,
        digest: materialDigest({
          revision: body.source.revision,
          metadata: body.metadata,
          primaryVideoId: body.primaryVideoId,
          videoChapters: body.videoChapters,
          publicationState: body.publicationState,
        }),
        publicationState: body.publicationState,
        archived: body.publicationState === "unpublished",
      };
      await persist();
    }

    if (!shell) await replayPracticeImports(context, request);

    // Reservations only create empty private drafts, so every publication conflict is found before
    // the first topic, Guide or Material write.
    /**
     * @type {Map<
     *   string,
     *   {
     *     materialId: string;
     *     contentVersion: number;
     *     primaryVideoId: string | null;
     *     cover?: { coverId: string } | null | undefined;
     *     metadata: { slug?: string | undefined };
     *     publicationState?: PublicationState | undefined;
     *   }
     * >}
     */
    const currentMaterials = new Map();
    /** @type {Map<string, string>} */
    const links = new Map();
    for (const row of rows.values()) {
      const previous = journal.materials[sourceId(row.sourceId)];
      const reserved =
        previous ??
        (await request("/authoring/import/materials/reserve", {
          source: source(row),
        }));
      const current =
        previous?.revision === source(row).revision &&
        previous.url !== undefined &&
        previous.url !== "" &&
        previous.primaryVideoId !== undefined &&
        previous.coverId !== undefined &&
        previous.archived !== true &&
        // A private import reads the target's own state: another journal may have published it.
        publicationOf(row) === "published"
          ? {
              materialId: previous.materialId,
              contentVersion: previous.contentVersion,
              primaryVideoId: previous.primaryVideoId,
              cover:
                previous.coverId === null
                  ? null
                  : { coverId: previous.coverId },
              metadata: { slug: previous.url.split("/").at(-1) },
            }
          : await request(`/authoring/materials/${reserved.materialId}`);
      if (!current.metadata.slug)
        throw new Error(
          "Source reservation did not allocate a stable local URL",
        );
      const conflict = publicationConflict(
        row,
        targetPublication(
          "publicationState" in current ? current.publicationState : undefined,
          previous,
        ),
        publicationOf(row),
      );
      if (conflict) throw new Error(conflict.message);
      currentMaterials.set(row.sourceId, current);
      links.set(row.sourceId, `/materials/${current.metadata.slug}`);
    }

    const teasers = new Map(
      pkg.manifest.guides.map((guide) => [guide.sourceId, guideTeaser(guide)]),
    );
    if ([...teasers.values()].some(({ partial }) => partial)) {
      report.notices.push({
        code: "guide_description_partial",
        message:
          "Кратким описанием продукта стал первый абзац. Полное описание страницы переносится отдельными блоками ключа page.",
      });
    }
    const topics = await request("/authoring/collections?kind=topic");
    const topicIds = new Map(topics.map((item) => [item.slug, item.id]));
    for (const id of new Set(
      pkg.manifest.materials
        .map((row) => row.topicId)
        .filter((topicId) => topicId !== null),
    )) {
      const name = topicNames[id];
      if (name === undefined)
        throw new Error(`Topic is outside the approved dictionary: ${id}`);
      if (!topicIds.has(id)) {
        const created = await request("/authoring/collections", {
          kind: "topic",
          slug: id,
          name,
          summary: "",
        });
        topicIds.set(id, created.id);
      }
    }
    /**
     * @param {ManifestMaterial} row
     * @param {Map<string, string>} links
     * @param {Map<string, string>} images
     */
    const convert = (row, links, images) =>
      convertMarkdown(row.markdown, {
        sourceId: sourceId(row.sourceId),
        sourcePath: row.sourcePath,
        link: (href) => {
          const linked = row.links[href] ?? row.links[decodeURI(href)];
          if (linked !== undefined) {
            if (!links.has(linked))
              throw new Error(
                `${row.sourcePath}: linked original is not in this selection: ${linked}`,
              );
            const fragment = new URL(href, "https://authoring.invalid").hash;
            return `${links.get(linked)}${fragment}`;
          }
          if (/^(https?:|mailto:|#)/u.test(href)) return href;
          throw new Error(`${row.sourcePath}: undeclared local link: ${href}`);
        },
        image: (href) => {
          const id = row.images[href] ?? row.images[decodeURI(href)];
          if (id === undefined || !images.has(id))
            throw new Error(`${row.sourcePath}: unresolved image: ${href}`);
          return valueAt(images, id);
        },
      });
    const placeholderLinks = new Map(
      [...rows.keys()].map((id) => [id, `/materials/${id}`]),
    );
    const placeholderImages = new Map(
      pkg.manifest.assets.map((asset) => [
        asset.sourceId,
        sourceUuid(asset.sourceId),
      ]),
    );
    /** @type {Map<string, StoredGuide>} */
    const guides = new Map();
    // Цель называет свой адрес и ключ источника, поэтому перенос не выдумывает адрес из ключа.
    const storedGuides =
      pkg.manifest.guides.length === 0
        ? []
        : await request("/authoring/collections?kind=guide");
    // The shell's chapter check runs before its first write.
    if (shell)
      for (const guide of pkg.manifest.guides) {
        const stored = storedGuides.find(
          (item) =>
            item.sourceId === sourceId(guide.sourceId) &&
            item.archived !== true,
        );
        if (stored === undefined) continue;
        const order = await request(`/authoring/guides/${stored.id}/order`);
        guideShellComposition(pkg.manifest, guide, order);
      }
    for (const guide of pkg.manifest.guides) {
      if (!guide.complete)
        throw new Error(
          "This first local programme adapter requires a complete Guide selection",
        );
      const key = sourceId(guide.sourceId);
      try {
        // Архивный продукт с тем же ключом адрес не подсказывает, и о нём говорит отчёт.
        const sameSource = storedGuides.filter((item) => item.sourceId === key);
        const stored = sameSource.find((item) => item.archived !== true);
        if (stored === undefined && sameSource.length > 0) {
          report.notices.push({
            code: "guide_archived",
            message: `Продукт ${guide.sourceId} в Platform архивирован: перенос продолжает его запись, восстановление остаётся решением владельца.`,
          });
        }
        const reserved = journal.guides[key];
        const address =
          guide.slug ?? stored?.slug ?? reserved?.slug ?? guide.sourceId;
        let current = await request("/authoring/import/guides/reserve", {
          sourceId: key,
          name: guide.title.trim(),
          slug: address,
          summary: guideTeaser(guide).teaser.trim(),
        });
        const details = guideDetails(guide, current);
        journal.guides[key] = {
          ...journal.guides[key],
          guideId: current.id,
          slug: current.slug,
        };
        // The page is checked here, before any Material is written; an unchanged product writes nothing.
        if (!guideDetailsMatch(current, details)) {
          current = await request("/authoring/import/guides/update", {
            sourceId: key,
            collectionId: current.id,
            expectedVersion: current.version,
            name: details.name,
            summary: details.summary,
            source: {
              slug: details.slug,
              presentation: details.presentation,
              page: details.page,
            },
          });
          journal.guides[key] = {
            ...journal.guides[key],
            slug: current.slug,
            version: current.version,
          };
        }
        guides.set(guide.sourceId, current);
        await persist();
      } catch (error) {
        throw new Error(`Product ${guide.sourceId}: ${errorMessage(error)}`, {
          cause: error,
        });
      }
    }

    if (shell) {
      for (const guide of pkg.manifest.guides) {
        const current = valueAt(guides, guide.sourceId);
        const order = await request(`/authoring/guides/${current.id}/order`);
        const composition = guideShellComposition(pkg.manifest, guide, order);
        // Omitted assignments keep every retained Material in its chapter; an unchanged shell writes nothing.
        await request("/authoring/import/guides/composition", {
          sourceId: sourceId(guide.sourceId),
          seriesId: current.id,
          expectedOrderVersion: order.orderVersion,
          orderedMaterialIds: composition.orderedMaterialIds,
          chapters: composition.chapters,
        });
        report.guides.push({
          title: guide.title,
          url: `${reader}/guides/${current.slug}`,
          programmeUrl: `${reader}/guides/${current.slug}/programme`,
          mainMaterials: order.items.length,
          supplementaryMaterials: [],
        });
      }
      const pending = pendingOperations(journal);
      if (pending)
        report.notices.push({
          code: "journal_pending",
          message: `Оболочка не продолжает ${String(pending)} незавершённых записей материалов; повторите перенос их пакета`,
        });
      return finish();
    }

    // Paid Materials must belong to a product, so validation uses the reserved Guides' real identities.
    // Supplementary originals are Guide members outside chapters: the product's "Additional Materials" part.
    const guideIds = new Map([...guides].map(([id, guide]) => [id, guide.id]));
    /**
     * @param {ManifestMaterial} row
     * @param {string | null} primaryVideoId
     */
    const desired = (row, primaryVideoId) =>
      desiredMaterial(pkg.manifest, row, {
        topicIds,
        guideIds,
        defaultAccess,
        primaryVideoId,
        publicationState: publicationOf(row),
      });
    // Validate every document before changing any previously correct Material; only empty Guide shells
    // and private reservations exist so far.
    for (const row of rows.values()) {
      if (
        journal.materials[sourceId(row.sourceId)]?.revision ===
          source(row).revision &&
        journal.materials[sourceId(row.sourceId)]?.defaultAccess ===
          defaultAccess
      )
        continue;
      try {
        await request("/authoring/import/materials/validate", {
          source: source(row),
          publicationState: publicationOf(row),
          metadata: desired(row, null).metadata,
          body: convert(row, placeholderLinks, placeholderImages),
          videoChapters: [],
        });
      } catch (error) {
        throw new Error(`${row.sourcePath}: ${errorMessage(error)}`, {
          cause: error,
        });
      }
    }

    // A public body may link a private draft; readers reach that link only once it is published.
    for (const row of rows.values()) {
      if (publicationOf(row) !== "published") continue;
      const drafts = [...new Set(Object.values(row.links))].filter((id) => {
        const linked = rows.get(id);
        return linked !== undefined && publicationOf(linked) === "draft";
      });
      if (drafts.length)
        report.notices.push({
          code: "link_to_draft",
          path: row.sourcePath,
          message: `Опубликованный материал ссылается на приватные черновики (${drafts.join(", ")}); читатели откроют ссылку только после их публикации`,
        });
    }

    /**
     * An existing provider record is attached once; the server refuses to move it to another Material.
     *
     * @param {ManifestMaterial} row
     * @param {{ materialId: string; primaryVideoId: string | null }} current
     * @param {import("./local-boundaries.mjs").Access} access
     * @returns {Promise<string | null>}
     */
    const attachVideo = async (row, current, access) => {
      if (row.video === null) {
        // A recording uploaded by authoring:video stays attached until the original names its provider record.
        const uploaded = parseReceipt(
          sourceVideoReceiptSchema,
          resources[`source-video:${sourceId(row.sourceId)}`],
        );
        return uploaded?.videoId ?? current.primaryVideoId;
      }
      const key = `video:${current.materialId}:${row.video.kinescopeId}`;
      const receipt = parseReceipt(attachedVideoReceiptSchema, resources[key]);
      if (
        receipt?.state === "ready" &&
        receipt.videoId === current.primaryVideoId
      )
        return current.primaryVideoId;
      const attached = receipt
        ? null
        : await request(
            `/authoring/materials/${current.materialId}/videos/attach`,
            { access, providerVideoId: row.video.kinescopeId },
          );
      if (attached) {
        resources[key] = {
          videoId: attached.videoId,
          state: attached.state,
        };
        await persist();
      }
      // Without a stored receipt the video was attached above.
      const known = attached ?? receipt;
      if (known === undefined)
        throw new Error(`${key}: video was not attached`);
      const videoId = known.videoId;
      if (known.state !== "ready") {
        await waitUntilReady(request, videoId, {
          sleep,
          attempts: videoAttempts,
          label: `${row.sourcePath} (${row.video.kinescopeId})`,
          onState: async (video) => {
            resources[key] = { videoId, state: video.state };
            await persist();
          },
        });
      }
      return videoId;
    };

    for (const row of rows.values()) {
      const key = sourceId(row.sourceId);
      let current = valueAt(currentMaterials, row.sourceId);
      const revision = source(row).revision;
      const previous = journal.materials[key];
      const primaryVideoId = await attachVideo(
        row,
        current,
        row.access ?? defaultAccess,
      );
      const {
        metadata: desiredMetadata,
        videoChapters,
        digest,
      } = desired(row, primaryVideoId);
      if (previous && current.contentVersion !== previous.contentVersion)
        throw new Error(
          `${row.sourcePath}: target changed; reconcile before overwriting`,
        );
      if (
        previous?.digest === digest &&
        current.contentVersion === previous.contentVersion &&
        !previous.archived
      ) {
        report.unchanged++;
      } else {
        /** @type {Map<string, string>} */
        const images = new Map();
        for (const assetId of new Set(Object.values(row.images))) {
          const asset = valueAt(assets, assetId);
          const upload = await imageUpload(await readAsset(asset), asset);
          const imageKey = `image:${current.materialId}:${upload.asset.sha256}`;
          let uploaded = parseReceipt(
            assetReceiptSchema,
            journal.operations[imageKey],
          );
          if (!uploaded) {
            uploaded = await request(
              `/authoring/materials/${current.materialId}/assets`,
              fileForm({ kind: "image" }, upload.bytes, upload.asset),
              imageKey,
            );
            journal.operations[imageKey] = uploaded;
            await persist();
          }
          images.set(assetId, uploaded.assetId);
        }
        const command = {
          source: source(row),
          materialId: current.materialId,
          expectedContentVersion: current.contentVersion,
          publicationState: publicationOf(row),
          metadata: desiredMetadata,
          body: convert(row, links, images),
          primaryVideoId,
          videoChapters,
        };
        const saved = materialReceiptSchema.parse(
          await applyJournaled(
            context,
            { path: "/authoring/import/materials/apply", body: command },
            (operation, operationKey) =>
              request(operation.path, operation.body, operationKey),
          ),
        );
        journal.materials[key] = {
          ...previous,
          materialId: saved.materialId,
          contentVersion: saved.contentVersion,
          digest,
          url: valueAt(links, row.sourceId),
          publicationState: publicationOf(row),
          archived: false,
        };
        current = { ...current, contentVersion: saved.contentVersion };
        await persist();
        report.applied++;
      }
      const synchronized = journal.materials[key];
      if (synchronized === undefined)
        throw new Error(`${row.sourcePath}: Material was not synchronized`);
      const cover = await syncCover(row, current, synchronized);
      Object.assign(synchronized, {
        revision,
        defaultAccess,
        access: desiredMetadata.access,
        primaryVideoId,
        url: valueAt(links, row.sourceId),
        guideSourceIds: productsOf(pkg.manifest, row).map((guide) =>
          sourceId(guide.sourceId),
        ),
        ...cover,
      });
      await persist();
      report.materials.push({
        sourceId: row.sourceId,
        title: row.title,
        url: `${reader}${links.get(row.sourceId)}`,
        publicationState: publicationOf(row),
      });
      if (row.kind === "video" && primaryVideoId === null)
        report.notices.push({
          code: "video_pending",
          path: row.sourcePath,
          message: "Текст перенесён; запись видео ещё не привязана в оригинале",
        });
    }

    /**
     * @param {ManifestMaterial} row
     * @param {{ materialId: string; cover?: { coverId: string } | null | undefined }} current
     * @param {Journal["materials"][string]} entry
     */
    async function syncCover(row, current, entry) {
      const known = {
        coverId: entry.coverId ?? current.cover?.coverId ?? null,
        coverSha256: entry.coverSha256 ?? null,
      };
      if (row.coverAssetId === null) {
        if (known.coverSha256 !== null)
          report.notices.push({
            code: "cover_removal_pending",
            path: row.sourcePath,
            message:
              "Обложка убрана из оригинала; снимите её в Platform вручную",
          });
        return known;
      }
      const asset = valueAt(assets, row.coverAssetId);
      if (known.coverSha256 === asset.sha256) return known;
      const bytes = await readAsset(asset);
      // The cover route has no idempotency key: a pending marker lets a retry adopt a change the lost response hid.
      const pendingKey = `cover-pending:${current.materialId}`;
      const pending = parseReceipt(
        pendingCoverReceiptSchema,
        resources[pendingKey],
      );
      resources[pendingKey] = {
        sha256: asset.sha256,
        expectedCoverId: known.coverId,
      };
      await persist();
      const form = fileForm(
        {
          sourceId: sourceId(row.sourceId),
          expectedCoverId: known.coverId ?? "null",
        },
        bytes,
        asset,
      );
      let coverId;
      try {
        coverId =
          (
            await request(
              `/authoring/import/content-covers/material/${current.materialId}`,
              form,
              undefined,
              { method: "PUT" },
            )
          ).cover?.coverId ?? null;
      } catch (error) {
        // Imported covers change only through this source, so a conflict after an unfinished upload is that upload.
        const currentCoverId = failureBodyField(error, "currentCoverId");
        if (
          failureStatus(error) !== 409 ||
          pending?.sha256 !== asset.sha256 ||
          typeof currentCoverId !== "string"
        )
          throw error;
        coverId = currentCoverId;
      }
      delete resources[pendingKey];
      return { coverId, coverSha256: asset.sha256 };
    }

    for (const guide of pkg.manifest.guides) {
      try {
        const current = valueAt(guides, guide.sourceId);
        const order = await request(`/authoring/guides/${current.id}/order`);
        const chapters = guideChapters(pkg.manifest, guide);
        const chapterAssignments = Object.fromEntries(
          guide.chapters.flatMap((chapter, index) => {
            // guideChapters keeps the order of guide.chapters.
            const chapterId = chapters[index]?.id;
            if (chapterId === undefined)
              throw new Error(`Chapter ${chapter.sourceId} has no identity`);
            return chapter.materialIds.map((id) => [
              valueAt(currentMaterials, id).materialId,
              chapterId,
            ]);
          }),
        );
        const orderedMaterialIds = [
          ...guide.materialIds,
          ...guide.supplementaryMaterialIds,
        ].map((id) => valueAt(currentMaterials, id).materialId);
        await request("/authoring/import/guides/composition", {
          sourceId: sourceId(guide.sourceId),
          seriesId: current.id,
          expectedOrderVersion: order.orderVersion,
          orderedMaterialIds,
          chapters,
          chapterAssignments,
        });
        await syncArtifacts(guide, current);
        report.guides.push({
          title: guide.title,
          url: `${reader}/guides/${current.slug}`,
          programmeUrl: `${reader}/guides/${current.slug}/programme`,
          mainMaterials: guide.materialIds.length,
          supplementaryMaterials: guide.supplementaryMaterialIds.map((id) => ({
            sourceId: id,
            url: `${reader}${links.get(id)}`,
          })),
        });
      } catch (error) {
        throw new Error(`Product ${guide.sourceId}: ${errorMessage(error)}`, {
          cause: error,
        });
      }
    }

    /**
     * Material artifacts become authoring-owned Guide artifacts linked back to every Material that
     * declares them.
     *
     * @param {ManifestGuide} guide
     * @param {StoredGuide} current
     */
    async function syncArtifacts(guide, current) {
      const guideSource = sourceId(guide.sourceId);
      const declared = artifactDeclarations(pkg.manifest, guide, defaultAccess);
      for (const [artifactSourceId, declaration] of declared) {
        const { artifact, access } = declaration;
        // Guide artifacts are public by placement, so one declared only by private drafts waits for publication.
        const owners = declaration.owners.filter(
          (row) => publicationOf(row) === "published",
        );
        if (owners.length === 0) {
          report.notices.push({
            code: "artifact_waits_publication",
            path: declaration.owners[0]?.sourcePath ?? artifact.sourceId,
            message: `Артефакт «${artifact.title}» перенесётся вместе с публикацией материала`,
          });
          continue;
        }
        const asset = valueAt(assets, artifact.assetId);
        const receiptKey = `artifact:${current.id}:${sourceId(artifactSourceId)}`;
        const fingerprint = artifactFingerprint(asset, artifact, access);
        let receipt = parseReceipt(
          artifactReceiptSchema,
          resources[receiptKey],
        );
        if (receipt?.fingerprint !== fingerprint) {
          const bytes = await readAsset(asset);
          const outcome = await request(
            `/authoring/import/guides/${current.id}/artifacts`,
            fileForm(
              {
                guideSourceId: guideSource,
                sourceId: sourceId(artifactSourceId),
                title: artifact.title,
                purpose: "",
                access,
              },
              bytes,
              asset,
            ),
          );
          if (outcome.outcome === "diverged") {
            report.notices.push({
              code: "artifact_diverged",
              path: owners[0]?.sourcePath ?? artifact.sourceId,
              message: `Артефакт «${artifact.title}» изменён в Platform; импорт его не перезаписал`,
            });
          }
          receipt = {
            artifactId: outcome.artifactId,
            fingerprint,
            materialIds:
              receipt?.artifactId === outcome.artifactId
                ? receipt.materialIds
                : null,
          };
          resources[receiptKey] = receipt;
          await persist();
        }
        const materialIds = owners
          .map((row) => valueAt(currentMaterials, row.sourceId).materialId)
          .sort();
        if (canonical(receipt.materialIds) !== canonical(materialIds)) {
          await request(
            `/authoring/guide-artifacts/${receipt.artifactId}/materials`,
            { materialIds },
            undefined,
            { method: "PUT" },
          );
          resources[receiptKey] = { ...receipt, materialIds };
          await persist();
        }
      }
      const placed = await request(`/authoring/guides/${current.id}/artifacts`);
      const expected = new Set([...declared.keys()].map(sourceId));
      for (const artifact of placed.artifacts) {
        if (
          artifact.origin === "authoring" &&
          (artifact.sourceId === null || !expected.has(artifact.sourceId))
        ) {
          report.notices.push({
            code: "artifact_missing",
            message: `Артефакт «${artifact.title}» больше не объявлен в оригиналах; уберите его из продукта в Platform, если он не нужен`,
          });
        }
      }
    }
    for (const row of rows.values()) {
      if (row.artifacts.length && productsOf(pkg.manifest, row).length === 0)
        report.notices.push({
          code: "artifacts_need_guide",
          path: row.sourcePath,
          message:
            "Артефакты самостоятельного материала переносятся только вместе с продуктом",
        });
    }

    await syncSourcePractices(manifest, context, request);

    // Proposed Materials are unpublished only when named explicitly.
    const requested = new Set(normalizeSourceIds(pkg.manifest, archive));
    for (const key of archiveProposalKeys(journal, pkg.manifest)) {
      const entry = journal.materials[key];
      if (entry === undefined)
        throw new Error(`${key}: archive proposal has no journal entry`);
      if (!requested.has(key)) {
        report.archiveProposals.push({
          sourceId: key,
          url: entry.url ? `${reader}${entry.url}` : null,
        });
        continue;
      }
      requested.delete(key);
      const last = Object.values(journal.operations)
        .flatMap((operation) => {
          if (!isJournalOperation(operation) || operation.status !== "applied")
            return [];
          const applied = materialApplyRequest(operation.request);
          return applied?.body.source.id === key
            ? [
                {
                  body: applied.body,
                  result: materialReceiptSchema.parse(operation.result),
                },
              ]
            : [];
        })
        .sort(
          (left, right) =>
            right.result.contentVersion - left.result.contentVersion,
        )[0];
      if (!last)
        throw new Error(
          `${key}: no applied original is recorded; archive it in Platform instead`,
        );
      const body = last.body;
      const command = {
        ...body,
        expectedContentVersion: entry.contentVersion,
        publicationState: "unpublished",
        metadata: { ...body.metadata, seriesIds: [] },
      };
      const saved = materialReceiptSchema.parse(
        await applyJournaled(
          context,
          { path: "/authoring/import/materials/apply", body: command },
          (operation, operationKey) =>
            request(operation.path, operation.body, operationKey),
        ),
      );
      Object.assign(entry, {
        contentVersion: saved.contentVersion,
        archived: true,
      });
      await persist();
      report.archived.push({ sourceId: key });
    }
    if (requested.size > 0)
      throw new Error(
        `Archive request names Materials that are still in the package or were never synchronized: ${[...requested].join(", ")}`,
      );
    if (report.archiveProposals.length)
      report.notices.push({
        code: "archive_proposed",
        message: `Оригиналы пропали для ${report.archiveProposals.length} материалов; повторите синхронизацию с --archive, если их нужно снять`,
      });
    return finish();

    async function finish() {
      // The local product view features the transferred product on Home, like production will.
      if (pinHome) await pinProduct();
      journal.lastReport = report;
      await persist();
      return report;
    }

    async function pinProduct() {
      const [product] = pkg.manifest.guides;
      if (pkg.manifest.guides.length !== 1 || product === undefined)
        throw new Error(
          "Pinning Home needs exactly one product in the package",
        );
      const guideId = valueAt(guides, product.sourceId).id;
      const pin = await request("/authoring/home-pin");
      if (pin.seriesId !== guideId)
        await request(
          "/authoring/home-pin",
          { seriesId: guideId, expectedVersion: pin.version },
          undefined,
          { method: "PUT" },
        );
      report.homePinned = guideId;
    }
  });
}

/**
 * The command-line approval: named originals, or every original of the package.
 *
 * @param {{ publish?: string[] | undefined; "publish-all"?: boolean | undefined }} values
 * @returns {PublishSelection}
 */
export function publishOption(values) {
  const named = values.publish ?? [];
  if (values["publish-all"] && named.length)
    throw new Error("Use either --publish-all or --publish, not both");
  return values["publish-all"] ? "all" : named;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      target: { type: "string", default: "editor" },
      archive: { type: "string", multiple: true, default: [] },
      publish: { type: "string", multiple: true, default: [] },
      "publish-all": { type: "boolean", default: false },
    },
  });
  const [packagePath, stateDirectory] = positionals;
  if (
    positionals.length !== 2 ||
    packagePath === undefined ||
    stateDirectory === undefined
  )
    throw new Error(
      "Usage: pnpm authoring:sync-local PACKAGE_JSON STATE_DIRECTORY [--target editor|stand] [--publish SOURCE_ID]... [--publish-all] [--archive SOURCE_ID]...",
    );
  const report = await syncLocal(packagePath, stateDirectory, {
    origin: resolveLocalTarget(values.target),
    archive: values.archive,
    publish: publishOption(values),
  });
  process.stdout.write(
    `${JSON.stringify({ packageId: report.packageId, scope: report.scope ?? "materials", applied: report.applied, unchanged: report.unchanged, guides: report.guides, archived: report.archived, archiveProposals: report.archiveProposals, notices: report.notices }, null, 2)}\n`,
  );
}
