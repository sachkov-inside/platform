// @ts-check
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

const identifier = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
  .max(200);
const relativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !isAbsolute(value) &&
      !value.includes("\\") &&
      !/^[A-Za-z]:/u.test(value) &&
      !value.split("/").includes("..") &&
      !Array.from(value).some((character) => character.charCodeAt(0) < 32),
    "Expected portable relative path",
  );
const chapters = z
  .array(
    z
      .object({
        start: z.number().int().nonnegative(),
        title: z.string().trim().min(1).max(200),
      })
      .strict(),
  )
  .max(200)
  .refine(
    (values) =>
      values.every((value, index) => {
        const previous = values[index - 1];
        return previous === undefined || value.start > previous.start;
      }),
    "Chapters must increase",
  );
export const sourcePracticeSchema = z
  .object({
    practiceId: z
      .string()
      .trim()
      .max(200)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    // The owning backend validates the complete authored definition during preflight.
    definition: z.record(z.string(), z.json()),
    sourceReference: z
      .object({
        materialSourceId: z.string().min(1).max(200),
        materialSourceRevision: z.hash("sha256"),
      })
      .strict(),
    provenance: z
      .object({
        repository: z
          .string()
          .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)
          .max(256),
        commit: z.hash("sha1"),
        path: relativePath,
      })
      .strict(),
    publicationState: z.enum(["published", "unpublished"]),
  })
  .strict();

/**
 * A Guide Task of the package (#946). Its source ID is the task code; Guide, chapter and related
 * Materials are named by their source IDs in this namespace. The order of a chapter's tasks in
 * `tasks` is their order in the chapter. `afterMaterialId` names the Material of the same chapter
 * right after which the programme shows the task (#947); without it the task stands at the start
 * of its chapter. `publicationState` is Content's intent: `unpublished`
 * withdraws the task, `published` publishes it only when the owner selects it for publication.
 */
export const sourceTaskSchema = z
  .object({
    sourceId: identifier.max(120),
    guideId: identifier,
    chapterId: identifier,
    title: z.string().trim().min(1).max(200),
    access: z.enum(["free", "membership"]),
    // The owning backend validates the complete authored definition during preflight.
    definition: z.record(z.string(), z.json()),
    relatedMaterialIds: z.array(identifier).max(50),
    afterMaterialId: identifier.optional(),
    publicationState: z.enum(["published", "unpublished"]),
    provenance: z
      .object({
        repository: z
          .string()
          .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)
          .max(256),
        commit: z.hash("sha1"),
        path: relativePath,
      })
      .strict(),
  })
  .strict();

/** The only explicit selection scope; a package without it selects Materials. */
export const guideShellScope = z.literal("guide-shell");

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceNamespace: identifier,
    practiceDefinitions: z.array(sourcePracticeSchema).max(100).optional(),
    tasks: z.array(sourceTaskSchema).max(200).optional(),
    selection: z
      .object({
        guideId: identifier.nullable(),
        chapterIds: z.array(identifier),
        materialIds: z.array(identifier),
        complete: z.literal(true),
        // An explicit Guide shell release (#803): only the product page and programme, no Materials.
        scope: guideShellScope.optional(),
      })
      .strict(),
    materials: z.array(
      z
        .object({
          sourceId: identifier,
          sourcePath: relativePath,
          sourceIds: z.array(identifier),
          relatedMaterialIds: z.array(identifier),
          readingTimeMinutes: z.number().int().positive().nullable(),
          kind: z.enum(["video", "guide", "note"]),
          title: z.string().min(1),
          summary: z.string().min(1),
          stage: z.enum(["idea", "draft", "review", "ready", "published"]),
          topicId: identifier.nullable(),
          access: z.enum(["free", "membership"]).nullable(),
          showInFeed: z.boolean(),
          difficulty: z.enum(["basic", "intermediate", "advanced"]).nullable(),
          outcomes: z.array(z.string()).nullable(),
          markdown: z.string(),
          links: z.record(z.string(), identifier),
          images: z.record(z.string(), z.string()),
          coverAssetId: z.string().nullable(),
          coverAlt: z.string().nullable(),
          video: z.object({ kinescopeId: z.uuid() }).strict().nullable(),
          videoChapters: chapters,
          artifacts: z.array(
            z
              .object({
                sourceId: identifier,
                title: z.string().min(1),
                assetId: z.string(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    // slug, presentation and page arrived with #671; packages exported before it describe no product page.
    guides: z.array(
      z
        .object({
          sourceId: identifier,
          slug: identifier.max(120).optional(),
          presentation: identifier.optional(),
          page: z
            .object({
              card: z.json().optional(),
              blocks: z.array(z.json()).min(1),
            })
            .strict()
            .nullable()
            .optional(),
          title: z.string().min(1),
          summary: z.string(),
          coverAssetId: z.string().nullable().optional(),
          coverAlt: z.string().nullable().optional(),
          complete: z.boolean(),
          chapters: z.array(
            z
              .object({
                sourceId: identifier,
                title: z.string().min(1),
                summary: z.string(),
                materialIds: z.array(identifier),
              })
              .strict(),
          ),
          materialIds: z.array(identifier),
          supplementaryMaterialIds: z.array(identifier),
        })
        .strict(),
    ),
    assets: z.array(
      z
        .object({
          sourceId: z.string(),
          path: relativePath,
          sha256: z.hash("sha256"),
          mimeType: z.string().min(1),
        })
        .strict(),
    ),
    diagnostics: z.array(
      z
        .object({
          code: z.string(),
          path: relativePath,
          line: z.number().int().positive(),
          message: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

/**
 * @param {unknown} value
 * @returns {string}
 */
export function canonical(value) {
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
/** @param {string | NodeJS.ArrayBufferView} value */
export const checksum = (value) =>
  createHash("sha256").update(value).digest("hex");
/** The same Material revision used by existing source import; practice sidecars are excluded.
 * @param {Manifest} manifest
 * @param {ManifestMaterial} row
 */
export function materialRevision(manifest, row) {
  return checksum(
    canonical({
      row,
      assets: manifest.assets.filter((asset) =>
        [
          ...Object.values(row.images),
          row.coverAssetId,
          ...row.artifacts.map((item) => item.assetId),
        ].includes(asset.sourceId),
      ),
    }),
  );
}

/** @param {string} path */
export async function fileChecksum(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    // Without an encoding a file stream yields bytes.
    if (!Buffer.isBuffer(chunk)) throw new Error("File stream yielded text");
    hash.update(chunk);
  }
  return hash.digest("hex");
}
/**
 * @param {unknown[]} values
 * @param {string} label
 */
function unique(values, label) {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate ${label}`);
}
/**
 * A Guide shell release carries the product page and its chapters, never a Material.
 *
 * @param {Pick<Manifest, "selection">} manifest
 */
export const isGuideShell = (manifest) =>
  manifest.selection.scope === guideShellScope.value;

/**
 * An empty selection is refused unless it explicitly asks for the Guide shell, whose absent
 * Materials never mean removal.
 *
 * @param {Manifest} manifest
 */
function checkSelectionScope(manifest) {
  if (!isGuideShell(manifest)) {
    if (manifest.selection.materialIds.length === 0)
      throw new Error(
        "Empty selection: a package without Materials must declare selection.scope guide-shell",
      );
    return;
  }
  const [guide] = manifest.guides;
  if (
    manifest.selection.guideId === null ||
    manifest.guides.length !== 1 ||
    guide?.sourceId !== manifest.selection.guideId
  )
    throw new Error("A Guide shell release names exactly its one Guide");
  if (
    manifest.selection.chapterIds.length ||
    manifest.selection.materialIds.length ||
    manifest.materials.length ||
    manifest.assets.length ||
    (manifest.practiceDefinitions ?? []).length ||
    (manifest.tasks ?? []).length
  )
    throw new Error(
      "A Guide shell release carries no chapter subset, Material, asset, practice or task",
    );
  if (
    !guide.complete ||
    guide.materialIds.length ||
    guide.supplementaryMaterialIds.length ||
    guide.chapters.some((chapter) => chapter.materialIds.length)
  )
    throw new Error(
      "A Guide shell release carries the complete chapter list without Material placement",
    );
}

/**
 * Every task names a Guide and chapter of this package; related Materials need not travel in it.
 *
 * @param {Manifest} manifest
 */
function checkTasks(manifest) {
  const tasks = manifest.tasks ?? [];
  unique(
    tasks.map((task) => task.sourceId),
    "task identity",
  );
  // `--publish` names a task by its code, so a code must not also name a Material.
  const materials = new Set(manifest.materials.map((row) => row.sourceId));
  for (const task of tasks)
    if (materials.has(task.sourceId))
      throw new Error(
        `${task.sourceId}: a task code repeats a Material identity`,
      );
  for (const task of tasks) {
    const guide = manifest.guides.find((row) => row.sourceId === task.guideId);
    if (guide === undefined)
      throw new Error(
        `${task.sourceId}: the task's Guide is not in the package`,
      );
    const chapter = guide.chapters.find(
      (row) => row.sourceId === task.chapterId,
    );
    if (chapter === undefined)
      throw new Error(
        `${task.sourceId}: the task's chapter is not in its Guide`,
      );
    if (
      task.afterMaterialId !== undefined &&
      !chapter.materialIds.includes(task.afterMaterialId)
    )
      throw new Error(
        `${task.sourceId}: the task follows a Material outside its chapter`,
      );
    unique(task.relatedMaterialIds, `${task.sourceId} related Material`);
  }
}

/**
 * The order of each task inside its chapter, from 1, as the package lists them.
 *
 * @param {Pick<Manifest, "tasks">} manifest
 * @returns {Map<string, number>}
 */
export function taskPositions(manifest) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {Map<string, number>} */
  const positions = new Map();
  for (const task of manifest.tasks ?? []) {
    const chapter = `${task.guideId}\n${task.chapterId}`;
    const position = (counts.get(chapter) ?? 0) + 1;
    counts.set(chapter, position);
    positions.set(task.sourceId, position);
  }
  return positions;
}

/**
 * @typedef {z.infer<typeof manifestSchema>} Manifest
 * @typedef {Manifest["materials"][number]} ManifestMaterial
 * @typedef {Manifest["guides"][number]} ManifestGuide
 * @typedef {Manifest["assets"][number]} ManifestAsset
 * @typedef {NonNullable<Manifest["tasks"]>[number]} ManifestTask
 * @typedef {{ id: string; manifest: Manifest; directory: string }} AuthoringPackage
 */

/**
 * @param {string} path
 * @returns {Promise<AuthoringPackage>}
 */
export async function loadPackage(path) {
  const manifestPath = await realpath(path);
  if ((await stat(manifestPath)).size > 32 * 1024 * 1024)
    throw new Error("Package manifest exceeds 32 MiB");
  const bytes = await readFile(manifestPath);
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (bytes.toString("utf8") !== canonical(manifest))
    throw new Error(
      "Package must use canonical JSON; rebuild it from originals",
    );
  unique(
    manifest.materials.map((item) => item.sourceId),
    "Material identity",
  );
  unique(
    manifest.guides.map((item) => item.sourceId),
    "Guide identity",
  );
  unique(
    manifest.assets.map((item) => item.sourceId),
    "asset identity",
  );
  checkSelectionScope(manifest);
  unique(manifest.selection.materialIds, "selection identity");
  const ids = new Set(manifest.materials.map((item) => item.sourceId));
  if (
    ids.size !== manifest.selection.materialIds.length ||
    manifest.selection.materialIds.some((id) => !ids.has(id))
  )
    throw new Error("Selection does not match package contents");
  const assets = new Map(manifest.assets.map((item) => [item.sourceId, item]));
  for (const guide of manifest.guides)
    if (
      guide.coverAssetId !== undefined &&
      guide.coverAssetId !== null &&
      !assets.has(guide.coverAssetId)
    )
      throw new Error(`${guide.sourceId}: missing cover asset`);
  for (const material of manifest.materials) {
    const refs = [
      ...Object.values(material.images),
      ...material.artifacts.map((item) => item.assetId),
      ...(material.coverAssetId === null ? [] : [material.coverAssetId]),
    ];
    if (refs.some((id) => !assets.has(id)))
      throw new Error(`${material.sourcePath}: missing asset`);
    unique(
      material.artifacts.map((item) => item.sourceId),
      "artifact identity",
    );
  }
  for (const guide of manifest.guides) {
    unique(
      guide.chapters.map((item) => item.sourceId),
      "chapter identity",
    );
    unique(
      [...guide.materialIds, ...guide.supplementaryMaterialIds],
      "Guide placement",
    );
    if (
      [...guide.materialIds, ...guide.supplementaryMaterialIds].some(
        (id) => !ids.has(id),
      )
    )
      throw new Error("Incomplete Guide contents");
    if (
      guide.chapters.length &&
      canonical(guide.chapters.flatMap((chapter) => chapter.materialIds)) !==
        canonical(guide.materialIds)
    )
      throw new Error("Chapter order does not match Guide order");
  }
  unique(
    (manifest.practiceDefinitions ?? []).map((item) => item.practiceId),
    "Practice identity",
  );
  for (const practice of manifest.practiceDefinitions ?? []) {
    if (!practice.practiceId.startsWith(`${manifest.sourceNamespace}:`))
      throw new Error("Practice identity belongs to another namespace");
    const row = manifest.materials.find(
      (item) =>
        `${manifest.sourceNamespace}:${item.sourceId}` ===
        practice.sourceReference.materialSourceId,
    );
    if (
      row === undefined ||
      practice.sourceReference.materialSourceRevision !==
        materialRevision(manifest, row)
    )
      throw new Error(
        "Practice reference does not match a complete selected Material revision",
      );
  }
  checkTasks(manifest);
  const directory = dirname(manifestPath);
  for (const asset of assets.values()) {
    const absolute = await realpath(resolve(directory, asset.path));
    const local = relative(directory, absolute);
    if (
      local === ".." ||
      local.startsWith(`..${sep}`) ||
      isAbsolute(local) ||
      !(await stat(absolute)).isFile()
    )
      throw new Error("Asset escapes package directory");
    if ((await fileChecksum(absolute)) !== asset.sha256)
      throw new Error(`Asset checksum mismatch: ${asset.path}`);
  }
  return { id: checksum(bytes), manifest, directory };
}
