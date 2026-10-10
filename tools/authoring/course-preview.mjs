// @ts-check
// A local acceptance profile, never an editorial or public access decision.
import { cp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  canonical,
  checksum,
  loadPackage,
  materialRevision,
} from "./package.mjs";

/** @param {import('./package.mjs').Manifest} original */
export function coursePreviewManifest(original) {
  const manifest = structuredClone(original);
  const product = manifest.products.find(
    (row) => row.sourceId === "inside-ai-engineering",
  );
  if (product === undefined || manifest.products.length !== 1)
    throw new Error("Course preview requires only Inside AI Engineering");
  // Explicit local acceptance choice for Content #56 / Platform #1284.
  const chapterIds = [
    "project-setup",
    "mvp-platform",
    "team-agent-infrastructure",
    "business-agent",
    "quality-and-production",
  ];
  if (
    !product.complete ||
    product.chapters.length !== chapterIds.length ||
    product.chapters.some(
      (chapter, index) => chapter.sourceId !== chapterIds[index],
    )
  )
    throw new Error(
      "Course preview refuses an unknown course programme; review its acceptance profile",
    );
  const first = product.chapters.find(
    (row) => row.sourceId === "project-setup",
  );
  if (first === undefined || first.materialIds.length === 0)
    throw new Error("Course preview needs project-setup materials");
  const free = new Set(first.materialIds);
  for (const row of manifest.materials)
    row.access = free.has(row.sourceId) ? "free" : "closed";
  for (const practice of manifest.practiceDefinitions ?? []) {
    const material = manifest.materials.find(
      (row) =>
        `${manifest.sourceNamespace}:${row.sourceId}` ===
        practice.sourceReference.materialSourceId,
    );
    if (material === undefined)
      throw new Error("Practice lesson is absent from course preview");
    practice.sourceReference.materialSourceRevision = materialRevision(
      manifest,
      material,
    );
    practice.publicationState = "published";
  }
  return manifest;
}

/** Preserve the verified original; store a separately hashed local preview beside it.
 * @param {string} packagePath
 * @param {string} stateDirectory */
export async function prepareCoursePreview(packagePath, stateDirectory) {
  const original = await loadPackage(packagePath);
  const bytes = canonical(coursePreviewManifest(original.manifest));
  const target = join(stateDirectory, "course-previews", checksum(bytes));
  const result = join(target, "package.json");
  if (existsSync(result)) {
    const previous = await loadPackage(result);
    if (previous.id !== checksum(bytes))
      throw new Error(
        "Local course preview changed; preserve it and reconcile before retrying",
      );
    return result;
  }
  await mkdir(target, { recursive: true });
  for (const asset of original.manifest.assets) {
    const destination = join(target, asset.path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(original.directory, asset.path), destination, {
      force: false,
      errorOnExist: false,
    });
  }
  await writeFile(result, bytes, { flag: "wx" });
  await loadPackage(result);
  return result;
}
