// @ts-check
import { z } from "zod";

const record = z.record(z.string(), z.unknown());

/** Rename a structural alias without merging two independently saved values.
 * @param {Record<string, unknown>} value
 * @param {string} oldName
 * @param {string} newName
 */
function rename(value, oldName, newName) {
  if (!Object.hasOwn(value, oldName)) return;
  if (Object.hasOwn(value, newName))
    throw new Error(`Authoring alias collision: ${oldName}/${newName}`);
  value[newName] = value[oldName];
  delete value[oldName];
}

/** @param {unknown} value */
const access = (value) => (value === "membership" ? "closed" : value);

/** The persisted fingerprint vocabulary predates #1065.
 * @param {unknown} value
 */
export const fingerprintAccess = (value) =>
  value === "closed" ? "membership" : value;

/** Decode only the package envelope; authored Markdown, pages and definitions stay opaque.
 * @param {unknown} value
 */
export function decodePackageV1(value) {
  const manifest = record.parse(value);
  rename(manifest, "guides", "products");
  const selection = record.parse(manifest["selection"]);
  rename(selection, "guideId", "productId");
  if (selection["scope"] === "guide-shell")
    selection["scope"] = "product-shell";
  manifest["selection"] = selection;
  if (Array.isArray(manifest["materials"]))
    manifest["materials"] = manifest["materials"].map((value) => {
      const row = record.parse(value);
      row["access"] = access(row["access"]);
      return row;
    });
  if (Array.isArray(manifest["tasks"]))
    manifest["tasks"] = manifest["tasks"].map((value) => {
      const task = record.parse(value);
      rename(task, "guideId", "productId");
      task["access"] = access(task["access"]);
      return task;
    });
  return manifest;
}

/** Decode cache envelopes, never the requests whose original bytes own their journal keys.
 * @param {unknown} value
 */
export function decodeJournalV1(value) {
  const journal = record.parse(value);
  rename(journal, "guides", "products");
  journal["products"] = Object.fromEntries(
    Object.entries(record.parse(journal["products"])).map(([key, value]) => {
      const product = record.parse(value);
      rename(product, "guideId", "productId");
      return [key, product];
    }),
  );
  journal["materials"] = Object.fromEntries(
    Object.entries(record.parse(journal["materials"])).map(([key, value]) => {
      const material = record.parse(value);
      rename(material, "guideSourceIds", "productSourceIds");
      for (const field of ["access", "defaultAccess"])
        if (Object.hasOwn(material, field))
          material[field] = access(material[field]);
      return [key, material];
    }),
  );
  if (journal["resources"] !== undefined)
    journal["resources"] = Object.fromEntries(
      Object.entries(record.parse(journal["resources"])).map(([key, value]) => {
        if (!key.startsWith("upload:")) return [key, value];
        const upload = record.parse(value);
        upload["access"] = access(upload["access"]);
        return [key, upload];
      }),
    );
  return journal;
}

/** A transport copy of an old command. The body/definition and user text are opaque.
 * @overload
 * @param {{ path: string; body?: unknown }} value
 * @returns {{ path: string; body?: unknown }}
 */
/**
 * @overload
 * @param {unknown} value
 * @returns {unknown}
 */
/**
 * @param {unknown} value
 */
export function canonicalAuthoringRequest(value) {
  const parsed = record.safeParse(value);
  if (!parsed.success || typeof parsed.data["path"] !== "string") return value;
  const request = parsed.data;
  const path = parsed.data["path"]
    .replace(
      /^\/authoring\/(import\/)?guides(?=\/|$)/u,
      "/authoring/$1products",
    )
    .replace(
      /^\/authoring\/guide-artifacts(?=\/|$)/u,
      "/authoring/product-artifacts",
    )
    .replace(
      /^\/authoring\/collections\?kind=guide$/u,
      "/authoring/collections?kind=product",
    );
  request["path"] = path;
  if (
    typeof request["body"] !== "object" ||
    request["body"] === null ||
    Array.isArray(request["body"]) ||
    request["body"] instanceof FormData
  )
    return request;
  const body = record.parse(request["body"]);
  if (
    path.startsWith("/authoring/import/products/") ||
    path === "/authoring/import/tasks/apply"
  ) {
    rename(body, "guideId", "productId");
    rename(body, "guideSourceId", "productSourceId");
    rename(body, "guideSourceIds", "productSourceIds");
  }
  if (path === "/authoring/collections" && body["kind"] === "guide")
    body["kind"] = "product";
  if (
    /^\/authoring\/import\/tasks\/(apply|validate)$/u.test(path) ||
    /^\/authoring\/materials\/[^/]+\/videos\/uploads$/u.test(path)
  )
    if (Object.hasOwn(body, "access")) body["access"] = access(body["access"]);
  if (
    /^\/authoring\/import\/materials\/(apply|reserve|validate)$/u.test(path) &&
    body["metadata"] !== undefined
  ) {
    const metadata = record.parse(body["metadata"]);
    if (Object.hasOwn(metadata, "access"))
      metadata["access"] = access(metadata["access"]);
    body["metadata"] = metadata;
  }
  request["body"] = body;
  return request;
}
