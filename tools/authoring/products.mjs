// @ts-check
import { z } from "zod";
import { localTransport } from "./target.mjs";

const productRowSchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    archived: z.boolean(),
    materialCount: z.number().int().nonnegative(),
    sourceId: z.string().nullable(),
    presentation: z.string().nullable(),
    page: z.unknown().optional(),
    pageRejected: z.boolean().optional(),
  })
  .passthrough();
const pinSchema = z.object({ seriesId: z.uuid().nullable() }).passthrough();

/**
 * @typedef {Awaited<ReturnType<typeof listProducts>>[number]} ProductListing
 */

/**
 * Every product of one environment: its permanent key, current address, look, Home pin and lessons.
 *
 * @param {import("./target.mjs").LocalTransport} request
 */
export async function listProducts(request) {
  const [rows, pin] = await Promise.all([
    request("/authoring/collections?kind=guide"),
    request("/authoring/home-pin"),
  ]);
  const pinned = pinSchema.parse(pin).seriesId;
  return z
    .array(productRowSchema)
    .parse(rows)
    .map((row) => ({
      sourceId: row.sourceId,
      id: row.id,
      slug: row.slug,
      name: row.name,
      presentation: row.presentation ?? "default",
      pinnedOnHome: row.id === pinned,
      lessons: row.materialCount,
      archived: row.archived,
      page:
        row.pageRejected === true ? "rejected" : row.page ? "stored" : "none",
    }));
}

/** @param {ProductListing[]} products */
export function formatProducts(products) {
  const header = [
    "sourceId",
    "slug",
    "presentation",
    "page",
    "home",
    "lessons",
    "name",
  ];
  const lines = products.map((item) => [
    item.sourceId ?? "— (Platform)",
    item.slug,
    item.presentation,
    item.page,
    item.pinnedOnHome ? "pinned" : "",
    String(item.lessons),
    `${item.name}${item.archived ? " (archived)" : ""}`,
  ]);
  const widths = header.map((title, index) =>
    Math.max(title.length, ...lines.map((line) => (line[index] ?? "").length)),
  );
  return [header, ...lines]
    .map((line) =>
      line
        .map((cell, index) => cell.padEnd(widths[index] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/**
 * @param {string} origin
 * @param {{ json?: boolean }} [options]
 */
export async function printProducts(origin, { json = false } = {}) {
  const products = await listProducts(localTransport(origin));
  process.stdout.write(
    `${json ? JSON.stringify(products, null, 2) : formatProducts(products)}\n`,
  );
}
