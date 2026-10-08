// @ts-check
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonical, checksum } from "./package.mjs";
import { convertMarkdown, sourceUuid } from "./markdown.mjs";
import { imageUpload } from "./image-upload.mjs";
import { applyJournaled } from "./journal.mjs";
import {
  assetReceiptSchema,
  materialReceiptSchema,
  parseReceipt,
} from "./local-boundaries.mjs";

/** @typedef {import('./package.mjs').ManifestTask} Task */
/** @typedef {{assetId:string,materialId:string}} PageAsset */
/** @typedef {{pageBody: ReturnType<typeof convertMarkdown>, resolvedLinks: Record<string,string>, resolvedImages: Record<string,PageAsset>}} PageImport */

/** Stable public Task routes are also available before its first apply.
 * @param {import('./package.mjs').Manifest} manifest */
export function taskLinks(manifest) {
  return new Map(
    (manifest.tasks ?? []).map((task) => {
      const product = manifest.products.find(
        (product) => product.sourceId === task.productId,
      );
      return [
        task.sourceId,
        `/products/${product?.slug ?? task.productId}/tasks/${task.sourceId}`,
      ];
    }),
  );
}

/** @param {Task} task @param {Map<string,string>} links @param {Map<string,string>} images */
export function taskPageBody(task, links, images) {
  const page = task.page;
  if (page === undefined)
    throw new Error(`${task.sourceId}: missing Task page`);
  return convertMarkdown(page.markdown, {
    sourceId: task.sourceId,
    sourcePath: page.sourcePath,
    link: (href) => {
      const id = page.links[href] ?? page.links[decodeURI(href)];
      if (id !== undefined) {
        const url = links.get(id);
        if (url === undefined)
          throw new Error(
            `${page.sourcePath}: linked original is not in this selection: ${id}`,
          );
        return `${url}${new URL(href, "https://authoring.invalid").hash}`;
      }
      if (/^(https?:|mailto:|#)/u.test(href)) return href;
      throw new Error(`${page.sourcePath}: undeclared local link: ${href}`);
    },
    image: (href) => {
      const id = page.images[href] ?? page.images[decodeURI(href)];
      const assetId = id === undefined ? undefined : images.get(id);
      if (assetId === undefined)
        throw new Error(`${page.sourcePath}: unresolved image: ${href}`);
      return assetId;
    },
  });
}

/** Convert before any writes with placeholder IDs; backend owns rendered-body validation.
 * @param {import('./package.mjs').AuthoringPackage} pkg */
export function preflightTaskPages(pkg) {
  /** @type {Map<string,string>} */
  const links = new Map(
    pkg.manifest.materials.map((row) => [
      row.sourceId,
      `/materials/${row.sourceId}`,
    ]),
  );
  for (const [id, url] of taskLinks(pkg.manifest)) links.set(id, url);
  const images = new Map(
    pkg.manifest.assets.map((asset) => [
      asset.sourceId,
      sourceUuid(asset.sourceId),
    ]),
  );
  for (const task of pkg.manifest.tasks ?? [])
    if (task.page !== undefined) taskPageBody(task, links, images);
}

/** Upload a closed, private backing Material whose body retains every Task page asset.
 * @param {import('./package.mjs').AuthoringPackage} pkg
 * @param {Task} task
 * @param {import('./journal.mjs').JournalContext} context
 * @param {import('./local-boundaries.mjs').LocalRequest} request
 * @param {Map<string,string>} links
 * @param {string} productId
 * @returns {Promise<PageImport>} */
export async function importTaskPage(
  pkg,
  task,
  context,
  request,
  links,
  productId,
) {
  const page = task.page;
  if (page === undefined)
    throw new Error(`${task.sourceId}: missing Task page`);
  if (
    Object.keys(page.images).length === 0 &&
    page.coverAssetId === null &&
    page.artifacts.length === 0
  )
    return {
      pageBody: taskPageBody(task, links, new Map()),
      resolvedLinks: Object.fromEntries(
        Object.entries(page.links).map(([href, id]) => [
          href,
          `${pkg.manifest.sourceNamespace}:${id}`,
        ]),
      ),
      resolvedImages: {},
    };
  const source = {
    id: `inside-task-page:${pkg.manifest.sourceNamespace}:${task.sourceId}`,
    path: page.sourcePath,
    revision: checksum(canonical({ page, assets: pkg.manifest.assets })),
    showInFeed: false,
  };
  const reserved = await request("/authoring/import/materials/reserve", {
    source,
  });
  const current = await request(`/authoring/materials/${reserved.materialId}`);
  if (
    current.publicationState !== undefined &&
    current.publicationState !== "draft"
  )
    throw new Error(`${task.sourceId}: Task backing Material is not private`);
  /** @type {Map<string,string>} */
  const images = new Map();
  /** @type {Record<string,PageAsset>} */
  const resolvedImages = {};
  const references = [
    ...Object.entries(page.images).map(([href, id]) => ({
      href,
      id,
      kind: "image",
    })),
    ...(page.coverAssetId === null
      ? []
      : [
          {
            href: `cover:${page.coverAssetId}`,
            id: page.coverAssetId,
            kind: "image",
          },
        ]),
    ...page.artifacts.map((artifact) => ({
      href: `artifact:${artifact.sourceId}`,
      id: artifact.assetId,
      kind: "file",
    })),
  ];
  for (const reference of references) {
    const asset = pkg.manifest.assets.find(
      (asset) => asset.sourceId === reference.id,
    );
    if (asset === undefined)
      throw new Error(`${task.sourceId}: missing page asset: ${reference.id}`);
    const bytes = await readFile(resolve(pkg.directory, asset.path));
    if (checksum(bytes) !== asset.sha256)
      throw new Error("Package asset changed during synchronization");
    const upload =
      reference.kind === "image"
        ? await imageUpload(bytes, asset)
        : { bytes, asset };
    const key = `task-page-asset:${reserved.materialId}:${reference.kind}:${upload.asset.sha256}`;
    let receipt = parseReceipt(
      assetReceiptSchema,
      context.journal.operations[key],
    );
    if (receipt === undefined) {
      const form = new FormData();
      form.set("kind", reference.kind);
      form.set("declaredSize", String(upload.bytes.length));
      form.set("checksumSha256", upload.asset.sha256);
      form.set(
        "file",
        new Blob([upload.bytes], { type: upload.asset.mimeType }),
        upload.asset.path.split("/").at(-1),
      );
      receipt = await request(
        `/authoring/materials/${reserved.materialId}/assets`,
        form,
        key,
      );
      context.journal.operations[key] = receipt;
      await context.persist();
    }
    images.set(reference.id, receipt.assetId);
    resolvedImages[reference.href] = {
      assetId: receipt.assetId,
      materialId: reserved.materialId,
    };
  }
  const pageBody = taskPageBody(task, links, images);
  const backingBody = {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: references.map((reference) => ({
        type: reference.kind === "image" ? "assetImage" : "assetFile",
        attrs: {
          nodeId: sourceUuid(`${source.id}:${reference.href}`),
          assetId: images.get(reference.id),
          ...(reference.kind === "image"
            ? { alt: page.coverAlt ?? page.title, caption: null }
            : {
                label:
                  page.artifacts.find(
                    (artifact) => artifact.assetId === reference.id,
                  )?.title ?? page.title,
              }),
        },
      })),
    },
  };
  // A page without assets needs no backing body nodes.
  if (references.length > 0)
    await applyJournaled(
      context,
      {
        path: "/authoring/import/materials/apply",
        body: {
          source,
          materialId: reserved.materialId,
          expectedContentVersion: current.contentVersion,
          publicationState: "draft",
          metadata: {
            title: page.title,
            summary: page.summary,
            access: "closed",
            difficulty: page.difficulty,
            outcomes: page.outcomes ?? [],
            topicId: null,
            formatId: page.kind,
            tagIds: [],
            seriesIds: [productId],
          },
          body: backingBody,
          primaryVideoId: null,
          videoChapters: [],
        },
      },
      async (operation, key) =>
        materialReceiptSchema.parse(
          await request(operation.path, operation.body, key),
        ),
    );
  return {
    pageBody,
    resolvedImages,
    resolvedLinks: Object.fromEntries(
      Object.entries(page.links).map(([href, id]) => [
        href,
        `${pkg.manifest.sourceNamespace}:${id}`,
      ]),
    ),
  };
}
