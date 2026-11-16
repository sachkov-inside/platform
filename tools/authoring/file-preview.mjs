// @ts-check
// The light preview (#2221): a lesson or Task page of a local package, shaped as the reader receives
// it from Platform, with no backend, database or sign-in. The Web preview server
// (apps/web/file-preview) serves these values and the package's own image files.
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  mapMaterialBlockChildren,
  renderMaterialBlocks,
} from "@inside/material-blocks";
import { materialFormatPresentation } from "../../apps/backend/src/modules/materials/domain/material-format.ts";
import { imageSourceKey, resolveImageVariants } from "./image-variants.mjs";
import { loadPackage } from "./package.mjs";
import { convertMarkdown, sourceUuid } from "./markdown.mjs";

/**
 * @typedef {import("./package.mjs").AuthoringPackage} AuthoringPackage
 * @typedef {import("./package.mjs").Manifest} Manifest
 * @typedef {import("./package.mjs").ManifestMaterial} ManifestMaterial
 * @typedef {import("./package.mjs").ManifestTask} ManifestTask
 * @typedef {import("@inside/material-blocks").RenderedBlock} RenderedBlock
 * @typedef {{ readonly sourceId: string; readonly path: string; readonly mimeType: string }} PreviewAssetFile
 * @typedef {{ readonly width: number; readonly height: number; readonly format?: "svg" }} ImagePresentation
 * @typedef {{
 *   readonly packagePath: string;
 *   readonly pkg: AuthoringPackage;
 *   readonly assets: ReadonlyMap<string, PreviewAssetFile>;
 *   readonly images: Map<string, Promise<ImagePresentation | null>>;
 * }} Preview
 * @typedef {{
 *   readonly code: string;
 *   readonly title: string;
 *   readonly access: "free" | "closed";
 *   readonly afterMaterialId: string | null;
 *   readonly availability: "available";
 *   readonly lastSubmittedAt: null;
 * }} CourseTask
 * @typedef {{
 *   readonly kind: "ready";
 *   readonly reference: { readonly id: string; readonly name: string; readonly slug: string };
 *   readonly chapters: readonly {
 *     readonly id: string;
 *     readonly name: string;
 *     readonly summary: string;
 *     readonly materialIds: readonly string[];
 *     readonly supplementaryMaterialIds: readonly string[];
 *     readonly tasks: readonly CourseTask[];
 *   }[];
 *   readonly items: readonly {
 *     readonly slug: string;
 *     readonly title: string;
 *     readonly materialId: string;
 *     readonly access: "free" | "closed";
 *     readonly availability: "available";
 *   }[];
 * }} PreviewCourse
 */

/**
 * The package a path names: a `package.json`, a package directory, or the export folder Content
 * Studio writes packages into, where the most recently written package wins.
 * @param {string} path
 */
export async function resolvePreviewPackage(path) {
  const target = resolve(path);
  const info = await stat(target).catch(() => null);
  if (info === null) throw new Error(`Preview: no package at ${target}`);
  if (info.isFile()) return target;
  const own = join(target, "package.json");
  if ((await stat(own).catch(() => null))?.isFile()) return own;
  const candidates = await Promise.all(
    (await readdir(target, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifest = join(target, entry.name, "package.json");
        const found = await stat(manifest).catch(() => null);
        return found?.isFile() ? { manifest, at: found.mtimeMs } : null;
      }),
  );
  const newest = candidates
    .filter((candidate) => candidate !== null)
    .toSorted((left, right) => right.at - left.at)[0];
  if (newest === undefined) throw new Error(`Preview: no package at ${target}`);
  return newest.manifest;
}

/**
 * Loads and checks the package exactly as a release does, so a preview fails on what the stand
 * would refuse.
 * @param {string} path
 * @returns {Promise<Preview>}
 */
export async function openPreview(path) {
  const packagePath = await resolvePreviewPackage(path);
  const pkg = await loadPackage(packagePath);
  return {
    packagePath,
    pkg,
    assets: new Map(
      pkg.manifest.assets.map((asset) => [
        sourceUuid(asset.sourceId),
        {
          sourceId: asset.sourceId,
          path: join(pkg.directory, asset.path),
          mimeType: asset.mimeType,
        },
      ]),
    ),
    images: new Map(),
  };
}

/** @param {Preview} preview */
export function previewIndex({ pkg: { manifest } }) {
  return {
    products: manifest.products.map((product) => ({
      sourceId: product.sourceId,
      title: product.title,
    })),
    materials: manifest.materials.map((row) => ({
      sourceId: row.sourceId,
      title: row.title,
      href: materialHref(row.sourceId),
    })),
    tasks: (manifest.tasks ?? []).map((task) => ({
      sourceId: task.sourceId,
      title: task.page?.title ?? task.title,
      href: taskHref(manifest, task),
    })),
  };
}

/**
 * The package file behind an asset address of a preview page.
 * @param {Preview} preview
 * @param {string} assetId
 */
export function previewAsset(preview, assetId) {
  return preview.assets.get(assetId) ?? null;
}

/**
 * A lesson as the reader receives it: metadata, rendered body with sized images, Glossary Terms,
 * its video and the course it belongs to.
 * @param {Preview} preview
 * @param {string} sourceId
 */
export async function previewMaterial(preview, sourceId) {
  const { manifest } = preview.pkg;
  const row = manifest.materials.find((item) => item.sourceId === sourceId);
  if (row === undefined) return null;
  const terms = new Set();
  const body = await hydrate(
    preview,
    render(preview, row, (id) => terms.add(id)),
  );
  const product = productOf(manifest, sourceId);
  const course = product === undefined ? null : courseOf(manifest, product);
  return {
    kind: /** @type {const} */ ("material"),
    material: {
      access: row.access ?? "closed",
      contentVersion: 1,
      cover: null,
      difficulty: row.difficulty,
      outcomes: row.outcomes ?? [],
      format: (({ name, slug }) => ({ name, slug }))(
        materialFormatPresentation(row.kind),
      ),
      materialId: materialId(manifest, row.sourceId),
      // A draft has no publication; the reader shows today's date in its place.
      publishedAt: new Date().toISOString(),
      productMemberships:
        product === undefined || course === null
          ? []
          : [
              {
                ordinal: product.materialIds.indexOf(row.sourceId) + 1,
                product: course.reference,
              },
            ],
      slug: row.sourceId,
      summary: row.summary,
      tags: [],
      title: row.title,
      topic: { name: row.topicId ?? "", slug: row.topicId ?? "" },
    },
    body,
    glossaryTerms: (manifest.glossaryTerms ?? [])
      .filter((term) => terms.has(term.sourceId))
      .map(readerTerm),
    // «Термины урока»: the terms this lesson introduces, for the card deck at its end.
    lessonTerms: (manifest.glossaryTerms ?? [])
      .filter((term) => term.introducedInMaterialId === row.sourceId)
      .map(readerTerm),
    primaryVideo:
      row.video === null
        ? null
        : {
            videoId: row.video.kinescopeId,
            title: row.title,
            state: /** @type {const} */ ("ready"),
            ...(row.videoChapters.length === 0
              ? {}
              : { chapters: row.videoChapters }),
          },
    course,
  };
}

/**
 * A Task as an open learner's Task page: its place, requirements and page body.
 * @param {Preview} preview
 * @param {string} sourceId
 */
export async function previewTask(preview, sourceId) {
  const { manifest } = preview.pkg;
  const task = manifest.tasks?.find((item) => item.sourceId === sourceId);
  if (task === undefined) return null;
  const product = manifest.products.find(
    (item) => item.sourceId === task.productId,
  );
  if (product === undefined)
    throw new Error(
      `${task.sourceId}: the task's Product is not in the package`,
    );
  const chapterIndex = product.chapters.findIndex(
    (chapter) => chapter.sourceId === task.chapterId,
  );
  const course = courseOf(manifest, product);
  const body =
    task.page === undefined
      ? undefined
      : await hydrate(
          preview,
          render(preview, task.page, () => undefined),
        );
  return {
    kind: /** @type {const} */ ("task"),
    page: {
      access: /** @type {const} */ ("open"),
      task: {
        code: task.sourceId,
        title: task.title,
        product: { slug: course.reference.slug, name: product.title },
        chapter: {
          name: product.chapters[chapterIndex]?.title ?? "",
          ordinal: chapterIndex + 1,
        },
        access: task.access ?? "closed",
        version: 1,
        definition: taskDefinitionSchema.parse(task.definition),
        ...(task.page === undefined || body === undefined
          ? {}
          : {
              page: {
                title: task.page.title,
                summary: task.page.summary,
                body: { schemaVersion: /** @type {const} */ (1), blocks: body },
                cover: null,
                artifacts: [],
              },
            }),
      },
      reviewProtocol: { version: "preview", instructions: [] },
      relatedMaterials: task.relatedMaterialIds.flatMap((id) => {
        const row = manifest.materials.find((item) => item.sourceId === id);
        return row === undefined
          ? []
          : [
              {
                materialId: materialId(manifest, id),
                slug: id,
                title: row.title,
                availability: /** @type {const} */ ("available"),
              },
            ];
      }),
      submission: { accepting: false },
    },
    course,
  };
}

/**
 * A Glossary Term as the reader reads it with the body.
 * @param {NonNullable<Manifest["glossaryTerms"]>[number]} term
 */
function readerTerm(term) {
  return {
    id: term.sourceId,
    title: term.title,
    englishTitle: term.englishTitle,
    shortDefinition: term.shortDefinition,
    fullDefinition: term.fullDefinition,
  };
}

/** @param {string} sourceId */
const materialHref = (sourceId) => `/materials/${sourceId}`;

/** @param {Manifest} manifest @param {ManifestTask} task */
function taskHref(manifest, task) {
  return `/products/${productSlug(manifest, task.productId)}/tasks/${task.sourceId}`;
}

/** @param {Manifest} manifest @param {string} productId */
function productSlug(manifest, productId) {
  return (
    manifest.products.find((product) => product.sourceId === productId)?.slug ??
    productId
  );
}

/** @param {Manifest} manifest @param {string} sourceId */
function materialId(manifest, sourceId) {
  return sourceUuid(`${manifest.sourceNamespace}:${sourceId}`);
}

/** @param {Manifest} manifest @param {string} sourceId */
function productOf(manifest, sourceId) {
  return manifest.products.find(
    (product) =>
      product.materialIds.includes(sourceId) ||
      product.supplementaryMaterialIds.includes(sourceId),
  );
}

/**
 * The published course composition the reader's programme is built from.
 * @param {Manifest} manifest
 * @param {Manifest["products"][number]} product
 * @returns {PreviewCourse}
 */
function courseOf(manifest, product) {
  const id = (/** @type {string} */ sourceId) => materialId(manifest, sourceId);
  return {
    kind: "ready",
    reference: {
      id: sourceUuid(`${manifest.sourceNamespace}:product:${product.sourceId}`),
      name: product.title,
      slug: product.slug ?? product.sourceId,
    },
    chapters: product.chapters.map((chapter) => ({
      id: chapter.sourceId,
      name: chapter.title,
      summary: chapter.summary,
      materialIds: chapter.materialIds.map(id),
      supplementaryMaterialIds: (chapter.supplementaryMaterialIds ?? []).map(
        id,
      ),
      tasks: (manifest.tasks ?? [])
        .filter(
          (task) =>
            task.productId === product.sourceId &&
            task.chapterId === chapter.sourceId,
        )
        .map((task) => ({
          code: task.sourceId,
          title: task.page?.title ?? task.title,
          access: task.access ?? "closed",
          afterMaterialId:
            task.afterMaterialId === undefined
              ? null
              : id(task.afterMaterialId),
          availability: "available",
          lastSubmittedAt: null,
        })),
    })),
    items: [
      ...product.materialIds,
      ...product.supplementaryMaterialIds,
    ].flatMap((sourceId) => {
      const row = manifest.materials.find((item) => item.sourceId === sourceId);
      return row === undefined
        ? []
        : [
            {
              slug: sourceId,
              title: row.title,
              materialId: id(sourceId),
              access: row.access ?? "closed",
              availability: /** @type {const} */ ("available"),
            },
          ];
    }),
  };
}

/**
 * The page's Markdown through the release conversion. A link to another original opens its
 * preview address; an image names its package asset.
 * @param {Preview} preview
 * @param {ManifestMaterial} row
 * @param {(id: string) => void} term
 * @returns {readonly RenderedBlock[]}
 */
function render(preview, row, term) {
  const { manifest } = preview.pkg;
  /** @type {Map<string, string>} */
  const images = new Map(
    manifest.assets.map((asset) => [
      asset.sourceId,
      sourceUuid(asset.sourceId),
    ]),
  );
  const document = convertMarkdown(row.markdown, {
    readerBlocks: row.readerBlocks,
    sourceId: `${manifest.sourceNamespace}:${row.sourceId}`,
    sourcePath: row.sourcePath,
    term,
    link: (href) => {
      const linked = row.links[href] ?? row.links[decodeURI(href)];
      if (linked === undefined) return href;
      const fragment = new URL(href, "https://preview.invalid").hash;
      const task = manifest.tasks?.find((item) => item.sourceId === linked);
      return `${task === undefined ? materialHref(linked) : taskHref(manifest, task)}${fragment}`;
    },
    imageVariants: (href) => resolveImageVariants(row, href, images),
    image: (href) => {
      const key = imageSourceKey(row.images, href);
      const id = key === undefined ? undefined : row.images[key];
      const assetId = id === undefined ? undefined : images.get(id);
      if (assetId === undefined)
        throw new Error(`${row.sourcePath}: unresolved image: ${href}`);
      return assetId;
    },
  });
  return renderMaterialBlocks(z.array(z.json()).parse(document.doc.content));
}

/**
 * Adds what Platform learns when it stores an image: its size and the widths it serves. The preview
 * serves the original file at every width, so each image has one variant.
 * @param {Preview} preview
 * @param {readonly RenderedBlock[]} blocks
 * @returns {Promise<RenderedBlock[]>}
 */
async function hydrate(preview, blocks) {
  /** @type {Map<string, ImagePresentation>} */
  const sizes = new Map();
  /** @param {RenderedBlock} block */
  const collect = async (block) => {
    if (block.kind === "image")
      for (const { assetId } of [block, ...variantImages(block)]) {
        const size = await imagePresentation(preview, assetId);
        if (size !== null) sizes.set(assetId, size);
      }
    /** @type {RenderedBlock[]} */
    const children = [];
    mapMaterialBlockChildren(block, (child) => {
      children.push(child);
      return child;
    });
    for (const child of children) await collect(child);
  };
  for (const block of blocks) await collect(block);
  /**
   * @template {{ readonly assetId: string }} T
   * @param {T} image
   */
  const sized = (image) => {
    const size = sizes.get(image.assetId);
    return size === undefined
      ? image
      : {
          ...image,
          ...size,
          variants: [{ width: size.width, height: size.height }],
        };
  };
  /** @param {RenderedBlock} block @returns {RenderedBlock} */
  const apply = (block) => {
    const nested = mapMaterialBlockChildren(block, apply);
    if (nested.kind !== "image") return nested;
    const variants = nested.imageVariants;
    return sized(
      variants === undefined
        ? nested
        : {
            ...nested,
            imageVariants: {
              wideLight: sized(variants.wideLight),
              wideDark: sized(variants.wideDark),
              tallLight: sized(variants.tallLight),
              tallDark: sized(variants.tallDark),
            },
          },
    );
  };
  return blocks.map(apply);
}

/**
 * The theme and layout variants an image block shows in place of its source image.
 * @param {Extract<RenderedBlock, { kind: "image" }>} block
 */
function variantImages({ imageVariants }) {
  return imageVariants === undefined
    ? []
    : [
        imageVariants.wideLight,
        imageVariants.wideDark,
        imageVariants.tallLight,
        imageVariants.tallDark,
      ];
}

/**
 * The size of an image file, read once per preview. A file sharp cannot read stays unsized, and
 * the reader shows its «image unavailable» state, as for a failed upload.
 * @param {Preview} preview
 * @param {string} assetId
 */
function imagePresentation(preview, assetId) {
  const known = preview.images.get(assetId);
  if (known !== undefined) return known;
  const asset = preview.assets.get(assetId);
  const measured =
    asset === undefined || !asset.mimeType.startsWith("image/")
      ? Promise.resolve(null)
      : sharp(asset.path)
          .metadata()
          .then(
            ({ width, height }) =>
              /** @type {ImagePresentation} */ ({
                width,
                height,
                ...(asset.mimeType === "image/svg+xml"
                  ? { format: "svg" }
                  : {}),
              }),
            () => null,
          );
  preview.images.set(assetId, measured);
  return measured;
}

const criterionLevel = z.enum(["required", "additional"]);

/**
 * The requirements as the learner's Task page reads them. Parsing keeps only the fields the page
 * shows: evidence lists of format C stay with the reviewer, as on Platform.
 */
const taskDefinitionSchema = z.union([
  z.object({
    schemaVersion: z.literal(2),
    format: z.literal("c"),
    intro: z.string(),
    freedom: z.string(),
    criteria: z.array(
      z.object({
        id: z.string(),
        level: criterionLevel,
        task: z.string(),
        explanation: z.string(),
        advice: z.string().optional(),
      }),
    ),
  }),
  z.object({
    situation: z.string(),
    result: z.array(z.string()),
    freedom: z.string(),
    criteria: z.array(
      z.object({
        id: z.string(),
        level: criterionLevel,
        requirement: z.string(),
        acceptableEvidence: z.array(z.string()),
      }),
    ),
  }),
]);
