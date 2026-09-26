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
      values.every(
        (value, index) => index === 0 || value.start > values[index - 1].start,
      ),
    "Chapters must increase",
  );
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceNamespace: identifier,
    selection: z
      .object({
        guideId: identifier.nullable(),
        chapterIds: z.array(identifier),
        materialIds: z.array(identifier).min(1),
        complete: z.literal(true),
      })
      .strict(),
    materials: z
      .array(
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
            access: z.enum(["free", "membership", "workshop"]).nullable(),
            showInFeed: z.boolean(),
            difficulty: z
              .enum(["basic", "intermediate", "advanced"])
              .nullable(),
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
      )
      .min(1),
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

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const checksum = (value) =>
  createHash("sha256").update(value).digest("hex");
export async function fileChecksum(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function unique(values, label) {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate ${label}`);
}
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
  unique(manifest.selection.materialIds, "selection identity");
  const ids = new Set(manifest.materials.map((item) => item.sourceId));
  if (
    ids.size !== manifest.selection.materialIds.length ||
    manifest.selection.materialIds.some((id) => !ids.has(id))
  )
    throw new Error("Selection does not match package contents");
  const assets = new Map(manifest.assets.map((item) => [item.sourceId, item]));
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
