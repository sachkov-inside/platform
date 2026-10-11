// @ts-check
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  loadPackage,
  canonical,
  checksum,
  productShellScope,
  isProductShell,
} from "./package.mjs";
import { writeAtomic } from "./journal.mjs";
import {
  artifactReceiptSchema,
  attachedVideoReceiptSchema,
  parseJournal,
  parseLocalResponse,
  parseReceipt,
  publishSelectionSchema,
  sourceVideoReceiptSchema,
} from "./local-boundaries.mjs";
import {
  archiveProposalKeys,
  artifactDeclarations,
  artifactFingerprint,
  desiredMaterial,
  productChapters,
  productDetails,
  productDetailsMatch,
  productShellComposition,
  normalizeSourceIds,
  pendingOperations,
  publicationConflict,
  publicationPolicy,
  publishOption,
  targetPublication,
  valueAt,
  sourceKey,
  syncLocal,
  validateProductPages,
} from "./local-sync.mjs";
import {
  assertTargetEnvironment,
  authoringTarget,
  transportFor,
} from "./target.mjs";
import { keychainStore, ownerSession } from "./credentials.mjs";
import { exportCommittedPackage } from "./git-local.mjs";
import { preflightTaskPages } from "./task-page.mjs";
import { previewTasks, resolveTaskAccess } from "./task-import.mjs";

/**
 * @typedef {import("./journal.mjs").Journal} Journal
 * @typedef {import("./local-sync.mjs").DefaultAccess} DefaultAccess
 * @typedef {import("./target.mjs").LocalTransport} LocalTransport
 * @typedef {object} MaterialChange
 * @property {string} sourceId
 * @property {string} title
 * @property {string} access
 * @property {boolean} showInFeed
 * @property {string | null} video
 * @property {"new" | "changed" | "restore" | "unchanged" | "conflict"} change
 * @property {boolean} [coverChange]
 * @property {boolean} [videoChange]
 * @property {import("./local-sync.mjs").DesiredPublication} publication
 * @property {{ from: import("./local-boundaries.mjs").PublicationState; to: import("./local-sync.mjs").DesiredPublication }} [publicationChange]
 * @property {string} [conflictReason]
 * @property {{ from: boolean; to: boolean }} [feedChange]
 * @property {{ from: string; to: string }} [accessChange]
 * @typedef {object} ProductChange
 * @property {string} sourceId
 * @property {string} title
 * @property {"new" | "composition" | "details" | "unchanged"} change
 * @property {number} materials
 * @property {string[]} artifactChanges
 * @property {string} [slug]
 * @property {string} [presentation]
 * @property {"none" | "new"} [page]
 * @property {boolean} [detailsChange]
 * @property {number} [chapterTextChanges]
 * @property {boolean} [pageChange]
 * @property {{ from: string; to: string }} [slugChange]
 * @property {{ from: string; to: string }} [presentationChange]
 * @property {number} [added]
 * @property {number} [removed]
 * @property {boolean} [reorderedOrRegrouped]
 * @property {{ added: number; removed: number }} [chapterListChange]
 */

/**
 * A release applies one reviewed package to one environment: a local loopback target, or a trusted
 * target named in target.mjs and reached with the owner's session (#805). Any other address is refused.
 *
 * @param {string} value
 */
export function releaseTarget(value) {
  try {
    return authoringTarget(value);
  } catch {
    throw new Error(
      `Release to ${value} is not enabled: only local loopback targets and the named trusted targets exist`,
    );
  }
}

/**
 * @param {string} stateDirectory
 * @param {string} target
 * @returns {Promise<Journal>}
 */
async function readJournal(stateDirectory, target) {
  try {
    const journal = parseJournal(
      JSON.parse(
        await readFile(join(resolve(stateDirectory), "journal.json"), "utf8"),
      ),
    );
    if (journal.target !== target)
      throw new Error("Release state belongs to another environment");
    return journal;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return {
        schemaVersion: 1,
        target,
        materials: {},
        products: {},
        operations: {},
        resources: {},
      };
    throw error;
  }
}

/**
 * Read-only comparison of a package with what this environment already holds.
 *
 * @param {string} packagePath
 * @param {string} stateDirectory
 * @param {{
 *   origin: string;
 *   request?: LocalTransport | undefined;
 *   defaultAccess?: DefaultAccess;
 *   taskAccess?: string[];
 *   confirmedProductRemovals?: string[];
 *   publish?: import("./local-boundaries.mjs").PublishSelection;
 *   accessToken?: import("./target.mjs").AccessToken | undefined;
 * }} options
 */
export async function previewRelease(
  packagePath,
  stateDirectory,
  {
    origin,
    request: transport,
    defaultAccess = "closed",
    publish = [],
    taskAccess = [],
    confirmedProductRemovals = [],
    accessToken,
  },
) {
  const target = releaseTarget(origin);
  const send = transport ?? transportFor(target, accessToken);
  /** @type {<P extends string>(path: P) => Promise<import("./local-boundaries.mjs").LocalResponse<P>>} */
  const request = async (path) => parseLocalResponse(path, await send(path));
  const original = await loadPackage(packagePath);
  const access = resolveTaskAccess(original.manifest, taskAccess);
  const pkg = { ...original, manifest: access.manifest };
  preflightTaskPages(pkg);
  const { manifest } = pkg;
  const shell = isProductShell(manifest);
  const publicationOfKey = publicationPolicy(manifest, publish);
  const transferManifest = termsForTransfer(manifest, publicationOfKey);
  const environment = await request("/authoring/import/materials/environment");
  assertTargetEnvironment(target, environment.mode);
  await validateProductPages(manifest, send);
  const journal = await readJournal(stateDirectory, target.id);
  /** @type {import('./local-boundaries.mjs').LocalRequest} */
  const termRequest = async (path, body, key) =>
    parseLocalResponse(path, await send(path, body, key));
  const terms = await previewSourceTerms(
    transferManifest,
    journal,
    termRequest,
  );
  const resources = journal.resources ?? {};
  const topics = await request("/authoring/collections?kind=topic");
  const topicIds = new Map(topics.map((item) => [item.slug, item.id]));
  // Продукт узнаётся и без журнала: цель называет свой sourceId, поэтому новый state-каталог не
  // выдаёт уже перенесённый продукт за новый.
  // Пакет одного материала не описывает продукт, поэтому и список продуктов ему не нужен.
  const storedProducts =
    manifest.products.length === 0
      ? []
      : await request("/authoring/collections?kind=product");
  const productIds = new Map(
    manifest.products.flatMap((product) => {
      const entry = journal.products[sourceKey(manifest, product.sourceId)];
      const stored = storedProducts.find(
        (item) =>
          item.sourceId === sourceKey(manifest, product.sourceId) &&
          item.archived !== true,
      );
      const id = entry?.productId ?? stored?.id;
      return id === undefined ? [] : [[product.sourceId, id]];
    }),
  );
  const removals = z.array(z.uuid()).max(100).parse(confirmedProductRemovals);
  const confirmed = [...new Set(removals)].sort();
  for (const id of confirmed) {
    if (
      ![...productIds.values()].includes(id) ||
      !storedProducts.some(
        (product) =>
          product.id === id &&
          product.archived !== true &&
          manifest.products.some(
            (row) => product.sourceId === sourceKey(manifest, row.sourceId),
          ),
      )
    )
      throw new Error(
        `Product removal confirmation is outside this package's target scope: ${id}`,
      );
  }
  const assets = new Map(
    manifest.assets.map((asset) => [asset.sourceId, asset]),
  );
  /** @type {MaterialChange[]} */
  const materials = [];
  /** @type {Record<string, number | string>} */
  const expected = {};
  for (const row of manifest.materials) {
    const key = sourceKey(manifest, row.sourceId);
    const entry = journal.materials[key];
    const item = {
      sourceId: row.sourceId,
      title: row.title,
      access: row.access ?? defaultAccess,
      showInFeed: row.showInFeed,
      video: row.video?.kinescopeId ?? null,
      publication: publicationOfKey(key),
    };
    if (!entry) {
      materials.push({
        ...item,
        change: "new",
        coverChange: row.coverAssetId !== null,
      });
      continue;
    }
    const current = await request(`/authoring/materials/${entry.materialId}`);
    expected[key] = current.contentVersion;
    // A named provider record that was never attached here makes the Material change on apply.
    const uploaded = parseReceipt(
      sourceVideoReceiptSchema,
      resources[`source-video:${key}`],
    );
    // Attaching the provider record of this Material's own upload returns the same Video.
    const attached =
      row.video === null
        ? (uploaded?.videoId ?? current.primaryVideoId)
        : (parseReceipt(
            attachedVideoReceiptSchema,
            resources[`video:${entry.materialId}:${row.video.kinescopeId}`],
          )?.videoId ??
          (uploaded?.providerVideoId === row.video.kinescopeId
            ? uploaded.videoId
            : `attach:${row.video.kinescopeId}`));
    const { digest } = desiredMaterial(manifest, row, {
      topicIds,
      productIds,
      defaultAccess,
      primaryVideoId: attached,
      publicationState: item.publication,
    });
    const currentPublication = targetPublication(
      current.publicationState,
      entry,
    );
    const publicationConflictFound = publicationConflict(
      row,
      currentPublication,
      item.publication,
    );
    const alreadyPublic = publicationConflictFound !== undefined;
    // A Video keeps the access it was attached with; changing a Material's access needs a new recording decision.
    const currentAccess = current.metadata.access ?? entry.access;
    const existingVideo =
      attached !== null && !String(attached).startsWith("attach:");
    const videoAccessConflict =
      existingVideo &&
      currentAccess !== undefined &&
      currentAccess !== item.access;
    const change =
      current.contentVersion !== entry.contentVersion ||
      videoAccessConflict ||
      alreadyPublic
        ? "conflict"
        : entry.archived
          ? "restore"
          : entry.digest !== digest
            ? "changed"
            : "unchanged";
    const coverSha =
      row.coverAssetId === null
        ? null
        : valueAt(assets, row.coverAssetId).sha256;
    materials.push({
      ...item,
      change,
      ...(attached !== current.primaryVideoId ? { videoChange: true } : {}),
      ...(videoAccessConflict ? { conflictReason: "video_access_change" } : {}),
      ...(publicationConflictFound
        ? { conflictReason: publicationConflictFound.code }
        : {}),
      ...(!alreadyPublic && currentPublication !== item.publication
        ? {
            publicationChange: {
              from: currentPublication,
              to: item.publication,
            },
          }
        : {}),
      ...(coverSha !== null && coverSha !== (entry.coverSha256 ?? null)
        ? { coverChange: true }
        : {}),
      ...(current.source?.showInFeed !== undefined &&
      current.source.showInFeed !== row.showInFeed
        ? {
            feedChange: { from: current.source.showInFeed, to: row.showInFeed },
          }
        : {}),
      ...(currentAccess !== undefined && currentAccess !== item.access
        ? { accessChange: { from: currentAccess, to: item.access } }
        : {}),
    });
  }
  /** @type {ProductChange[]} */
  const products = [];
  const currentProducts = storedProducts;
  for (const product of manifest.products) {
    const programme = [
      ...product.materialIds,
      ...product.supplementaryMaterialIds,
    ];
    const productId = productIds.get(product.sourceId);
    const artifactChanges = [
      ...artifactDeclarations(manifest, product, defaultAccess),
    ]
      .filter(([artifactSourceId, { artifact, access }]) => {
        const receipt =
          productId === undefined
            ? undefined
            : parseReceipt(
                artifactReceiptSchema,
                resources[
                  `artifact:${productId}:${sourceKey(manifest, artifactSourceId)}`
                ],
              );
        return (
          receipt?.fingerprint !==
          artifactFingerprint(
            valueAt(assets, artifact.assetId),
            artifact,
            access,
          )
        );
      })
      .map(([artifactSourceId]) => artifactSourceId);
    const stored =
      productId === undefined
        ? undefined
        : currentProducts.find((item) => item.id === productId);
    const details = productDetails(product, stored);
    if (productId === undefined) {
      products.push({
        sourceId: product.sourceId,
        title: product.title,
        change: "new",
        materials: programme.length,
        artifactChanges,
        slug: details.slug,
        presentation: details.presentation,
        page: details.page === null ? "none" : "new",
        ...(shell
          ? {
              chapterListChange: { added: product.chapters.length, removed: 0 },
            }
          : {}),
      });
      continue;
    }
    const order = await request(`/authoring/products/${productId}/order`);
    expected[`${sourceKey(manifest, product.sourceId)}:order`] =
      order.orderVersion;
    // A page edited on the target after the review is drift, not something apply may overwrite.
    if (stored !== undefined)
      expected[`${sourceKey(manifest, product.sourceId)}:product`] =
        stored.version;
    const ids = new Map(
      programme.map((id) => [
        id,
        journal.materials[sourceKey(manifest, id)]?.materialId,
      ]),
    );
    const currentOrder = order.items.map((item) => item.materialId);
    // A Product shell keeps the Materials the target holds, in their order and chapters.
    const shellComposition = shell
      ? productShellComposition(manifest, product, order)
      : undefined;
    const desiredOrder =
      shellComposition?.orderedMaterialIds ??
      programme.map((id) => ids.get(id) ?? `new:${id}`);
    const chapterOf = new Map(
      product.chapters.flatMap((chapter) =>
        chapter.materialIds.map((id) => [ids.get(id), chapter.title]),
      ),
    );
    const currentChapters = new Map(
      order.chapters.map((chapter) => [chapter.id, chapter.name]),
    );
    const currentChapterText = new Map(
      order.chapters.map((chapter) => [
        chapter.id,
        canonical({ name: chapter.name, summary: chapter.summary }),
      ]),
    );
    const desiredChapters = productChapters(manifest, product);
    const desiredChapterIds = desiredChapters.map((chapter) => chapter.id);
    const currentChapterIds = order.chapters.map((chapter) => chapter.id);
    const chapterListChange = {
      added: desiredChapterIds.filter((id) => !currentChapterIds.includes(id))
        .length,
      removed: currentChapterIds.filter((id) => !desiredChapterIds.includes(id))
        .length,
    };
    const chaptersChanged =
      canonical(desiredChapterIds) !== canonical(currentChapterIds);
    const chapterTextChanges = desiredChapters.filter(
      (chapter) =>
        currentChapterText.has(chapter.id) &&
        currentChapterText.get(chapter.id) !==
          canonical({ name: chapter.name, summary: chapter.summary }),
    ).length;
    // Цель отдаёт своё описание страницы, поэтому сравнение не зависит от журнала.
    const pageChange =
      stored !== undefined &&
      (stored.pageRejected === true ||
        canonical(stored.page ?? null) !== canonical(details.page));
    const slugChange =
      stored !== undefined && stored.slug !== details.slug
        ? { from: stored.slug, to: details.slug }
        : undefined;
    const presentationChange =
      stored !== undefined &&
      (stored.presentation ?? "default") !== details.presentation
        ? { from: stored.presentation ?? "default", to: details.presentation }
        : undefined;
    const detailsChange =
      stored === undefined || !productDetailsMatch(stored, details);
    // A shell that would move a placed Material is refused while composing it.
    const moved = shellComposition
      ? 0
      : order.items.filter(
          (item) =>
            (chapterOf.get(item.materialId) ?? null) !==
            (item.chapterId === null
              ? null
              : (currentChapters.get(item.chapterId) ?? null)),
        ).length;
    products.push({
      sourceId: product.sourceId,
      title: product.title,
      materials: programme.length,
      artifactChanges,
      change:
        canonical(desiredOrder) === canonical(currentOrder) &&
        moved === 0 &&
        !chaptersChanged &&
        chapterTextChanges === 0
          ? detailsChange
            ? "details"
            : "unchanged"
          : "composition",
      detailsChange,
      chapterTextChanges,
      pageChange,
      ...(slugChange ? { slugChange } : {}),
      ...(presentationChange ? { presentationChange } : {}),
      ...(chaptersChanged ? { chapterListChange } : {}),
      added: desiredOrder.filter((id) => !currentOrder.includes(id)).length,
      removed: currentOrder.filter((id) => !desiredOrder.includes(id)).length,
      reorderedOrRegrouped:
        canonical(desiredOrder.filter((id) => currentOrder.includes(id))) !==
          canonical(currentOrder.filter((id) => desiredOrder.includes(id))) ||
        moved > 0,
    });
  }
  // Product Tasks follow the Product; validation reads their target revision without a write.
  const taskPreview = await previewTasks(
    manifest,
    journal,
    async (path, body) => parseLocalResponse(path, await send(path, body)),
    (key) => publicationOfKey(key) === "published",
  );
  Object.assign(expected, taskPreview.expected);
  const archiveProposals = archiveProposalKeys(journal, manifest);
  // The owner's publication approval is part of what apply must match.
  /** @type {{ publish?: import("./local-boundaries.mjs").PublishSelection }} */
  const approval =
    publish === "all"
      ? { publish }
      : publish.length
        ? { publish: normalizeSourceIds(manifest, publish).sort() }
        : {};
  const plan = {
    schemaVersion: 1,
    target: target.id,
    environment: environment.mode,
    packageId: pkg.id,
    packagePath: resolve(packagePath),
    namespace: manifest.sourceNamespace,
    ...approval,
    ...(confirmed.length === 0 ? {} : { confirmedProductRemovals: confirmed }),
    ...(access.choices.length === 0 ? {} : { taskAccess: access.choices }),
    ...(shell ? { scope: productShellScope.value } : {}),
    // A shell leaves these writes for their own package; the reviewer sees them before apply.
    ...(shell && pendingOperations(journal)
      ? { pendingMaterialWrites: pendingOperations(journal) }
      : {}),
    expected,
    materials,
    products,
    ...(taskPreview.tasks.length ? { tasks: taskPreview.tasks } : {}),
    ...(terms.length ? { terms } : {}),
    archiveProposals,
  };
  const preview = { ...plan, fingerprint: checksum(canonical(plan)) };
  const summary = Object.fromEntries(
    ["new", "changed", "restore", "unchanged", "conflict"].map((change) => [
      change,
      materials.filter((item) => item.change === change).length,
    ]),
  );
  const directory = join(resolve(stateDirectory), "previews");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${preview.fingerprint}.json`);
  await writeAtomic(path, preview);
  return { path, preview, summary };
}

const previewSchema = z
  .object({
    schemaVersion: z.literal(1),
    target: z.string(),
    environment: z.string(),
    packageId: z.hash("sha256"),
    packagePath: z.string(),
    namespace: z.string(),
    scope: productShellScope.optional(),
    publish: publishSelectionSchema.optional(),
    taskAccess: z.array(z.string()).optional(),
    confirmedProductRemovals: z.array(z.uuid()).max(100).optional(),
    pendingMaterialWrites: z.number().int().positive().optional(),
    expected: z.record(z.string(), z.union([z.number().int(), z.string()])),
    materials: z.array(z.object({ change: z.string() }).passthrough()),
    products: z.array(z.json()),
    tasks: z.array(z.object({ change: z.string() }).passthrough()).optional(),
    terms: z
      .array(
        z
          .object({
            termId: z.uuid(),
            termVersion: z.number().int().positive().nullable(),
            publicationState: z.enum(["draft", "published", "unpublished"]),
            change: z.enum(["new", "changed", "unchanged"]),
          })
          .strict(),
      )
      .optional(),
    archiveProposals: z.array(z.string()),
    fingerprint: z.hash("sha256"),
  })
  .strict();

/**
 * Applies exactly the reviewed preview. Unfinished writes this journal already started are first
 * completed with their original keys; any other drift since the preview stops before a new write.
 *
 * @param {string} previewPath
 * @param {string} stateDirectory
 * @param {{
 *   archive?: string[];
 *   request?: LocalTransport | undefined;
 *   accessToken?: import("./target.mjs").AccessToken | undefined;
 * }} [options]
 */
export async function applyRelease(
  previewPath,
  stateDirectory,
  { archive = [], request: transport, accessToken } = {},
) {
  const preview = previewSchema.parse(
    JSON.parse(await readFile(previewPath, "utf8")),
  );
  const { fingerprint, ...plan } = preview;
  if (checksum(canonical(plan)) !== fingerprint)
    throw new Error("Preview file was changed after review");
  const target = releaseTarget(preview.target);
  if (preview.environment !== target.environment)
    throw new Error(
      `The preview was made against a ${preview.environment} runtime; ${target.id} is ${target.environment}`,
    );
  if (
    preview.materials.some((item) => item.change === "conflict") ||
    (preview.tasks ?? []).some((item) => item.change === "conflict")
  )
    throw new Error(
      "The preview contains conflicts; reconcile them and preview again",
    );
  const unapproved = normalizeSourceIds(
    { sourceNamespace: preview.namespace },
    archive,
  ).filter((id) => !preview.archiveProposals.includes(id));
  if (unapproved.length)
    throw new Error(
      `Archive is limited to the reviewed proposals: ${unapproved.join(", ")}`,
    );
  const pkg = await loadPackage(preview.packagePath);
  if (pkg.id !== preview.packageId)
    throw new Error("Package differs from the reviewed preview");
  const publish = preview.publish ?? [];
  const taskAccess = preview.taskAccess ?? [];
  const confirmedProductRemovals = preview.confirmedProductRemovals ?? [];
  // A write whose outcome was lost is completed with its original key first; if it changed the
  // target, the reviewed plan no longer matches and a new preview is required.
  await syncLocal(preview.packagePath, stateDirectory, {
    origin: target.id,
    request: transport,
    publish,
    accessToken,
    reconcileOnly: true,
    reviewed: true,
    reviewedTaskAccess: taskAccess,
    reviewedProductRemovals: confirmedProductRemovals,
  });
  // The recomputed plan must be the reviewed one: versions, local receipts and every listed change.
  const current = await previewRelease(preview.packagePath, stateDirectory, {
    origin: target.id,
    request: transport,
    publish,
    taskAccess,
    confirmedProductRemovals,
    accessToken,
  });
  if (current.preview.fingerprint !== fingerprint)
    throw new Error(
      "The environment changed after the preview; preview again before releasing",
    );
  return syncLocal(preview.packagePath, stateDirectory, {
    origin: target.id,
    request: transport,
    archive,
    publish,
    accessToken,
    reviewed: true,
    reviewedTaskAccess: taskAccess,
    reviewedProductRemovals: confirmedProductRemovals,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      package: { type: "string" },
      content: { type: "string" },
      product: { type: "string" },
      ref: { type: "string", default: "HEAD" },
      target: { type: "string" },
      state: { type: "string" },
      preview: { type: "string" },
      archive: { type: "string", multiple: true, default: [] },
      publish: { type: "string", multiple: true, default: [] },
      "publish-all": { type: "boolean", default: false },
      "task-access": { type: "string", multiple: true, default: [] },
      "confirm-product-removal": {
        type: "string",
        multiple: true,
        default: [],
      },
    },
  });
  const [command] = positionals;
  if (command !== "preview" && values["task-access"].length > 0)
    throw new Error(
      "--task-access is a preview choice; apply uses the reviewed choices",
    );
  if (command !== "preview" && values["confirm-product-removal"].length > 0)
    throw new Error(
      "--confirm-product-removal is a preview choice; apply uses the reviewed choices",
    );
  /** @param {string} value */
  const sessionFor = (value) => {
    const target = releaseTarget(value);
    return target.kind === "trusted"
      ? ownerSession(target, { store: keychainStore() })
      : undefined;
  };
  if (
    command === "preview" &&
    (values.package || (values.content && values.product)) &&
    values.target &&
    values.state
  ) {
    // A Content checkout is exported at one committed revision; a ready package is used as given.
    const exported =
      values.package === undefined && values.content && values.product
        ? await exportCommittedPackage(
            values.content,
            values.product,
            values.state,
            values.ref,
          )
        : undefined;
    const packagePath = exported?.packagePath ?? values.package;
    if (packagePath === undefined) throw new Error("Name a package or Content");
    const { path, summary, preview } = await previewRelease(
      packagePath,
      values.state,
      {
        origin: values.target,
        publish: publishOption(values),
        taskAccess: values["task-access"],
        confirmedProductRemovals: values["confirm-product-removal"],
        accessToken: sessionFor(values.target),
      },
    );
    process.stdout.write(
      `${JSON.stringify({ preview: path, ...(exported ? { commit: exported.commit } : {}), scope: preview.scope ?? "materials", taskAccess: preview.taskAccess ?? [], confirmedProductRemovals: preview.confirmedProductRemovals ?? [], publish: preview.publish ?? [], summary, products: preview.products, tasks: preview.tasks ?? [], terms: preview.terms ?? [], archiveProposals: preview.archiveProposals, changes: preview.materials.filter((item) => item.change !== "unchanged") }, null, 2)}\n`,
    );
  } else if (command === "apply" && values.preview && values.state) {
    const reviewed = z
      .object({ target: z.string() })
      .passthrough()
      .parse(JSON.parse(await readFile(values.preview, "utf8")));
    const report = await applyRelease(values.preview, values.state, {
      archive: values.archive,
      accessToken: sessionFor(reviewed.target),
    });
    process.stdout.write(
      `${JSON.stringify({ applied: report.applied, unchanged: report.unchanged, archived: report.archived, products: report.products, tasks: report.tasks ?? [], terms: report.terms ?? [] }, null, 2)}\n`,
    );
  } else {
    throw new Error(
      "Usage: pnpm authoring:release preview (--package PACKAGE_JSON | --content CONTENT_REPOSITORY --product PRODUCT_ID [--ref REF]) --target editor|stand|production --state STATE_DIRECTORY [--publish SOURCE_ID]... [--publish-all] [--task-access CODE=free|closed]... [--confirm-product-removal PRODUCT_UUID]...\n       pnpm authoring:release apply --preview PREVIEW_JSON --state STATE_DIRECTORY [--archive SOURCE_ID]...",
    );
  }
}
import { termsForTransfer, previewSourceTerms } from "./term-import.mjs";
