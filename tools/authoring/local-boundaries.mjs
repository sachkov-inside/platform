import { z } from "zod";
import { canonical, checksum } from "./package.mjs";

const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z.string().min(1);
const hash = z.hash("sha256");
// Validate consumed fields, preserving additional wire fields and exact replay bytes.
const source = z.object({ id: text, path: text, revision: hash, showInFeed: z.boolean() }).passthrough();
export const materialReceiptSchema = z.object({ materialId: z.uuid(), contentVersion: version }).passthrough();
const materialSchema = materialReceiptSchema.extend({
  primaryVideoId: z.uuid().nullable(), metadata: z.object({ slug: text }).passthrough(),
  source: source.nullable(),
});
const topicSchema = z.object({ id: z.uuid(), slug: text }).passthrough();
const guideSchema = topicSchema.extend({ name: z.string(), summary: z.string(), version });
const orderSchema = z.object({ orderVersion: hash }).passthrough();
export const assetReceiptSchema = z.object({ assetId: z.uuid() }).passthrough();
const applyBodySchema = z.object({
  source, materialId: z.uuid(), expectedContentVersion: version,
  publicationState: z.enum(["draft", "published", "unpublished"]),
  metadata: z.object({
    title: z.string().nullable(), summary: z.string().nullable(),
    access: z.enum(["free", "membership", "workshop"]),
    difficulty: z.enum(["basic", "intermediate", "advanced"]).nullable(),
    outcomes: z.array(z.string()), topicId: z.uuid().nullable(), formatId: z.string().nullable(),
    tagIds: z.array(z.uuid()), seriesIds: z.array(z.uuid()),
  }).passthrough(),
  body: z.object({ schemaVersion: version, doc: z.json() }).passthrough(),
  primaryVideoId: z.uuid().nullable(),
  videoChapters: z.array(z.object({ start: z.number().int().nonnegative(), title: text }).passthrough()).optional(),
}).passthrough();

export function parseLocalResponse(path, value) {
  let schema;
  switch (path) {
    case "/authoring/import/materials/environment": schema = z.object({ mode: z.enum(["development", "test", "production"]) }).passthrough(); break;
    case "/authoring/collections?kind=topic": schema = z.array(topicSchema); break;
    case "/authoring/collections": schema = topicSchema; break;
    case "/authoring/import/materials/validate": schema = z.object({ valid: z.literal(true) }).passthrough(); break;
    case "/authoring/import/materials/reserve":
    case "/authoring/import/materials/apply": schema = materialReceiptSchema; break;
    case "/authoring/import/guides/reserve":
    case "/authoring/import/guides/update": schema = guideSchema; break;
    case "/authoring/import/guides/composition": schema = orderSchema; break;
    default:
      if (path.startsWith("/authoring/materials/")) schema = materialSchema;
      else if (path.startsWith("/authoring/guides/") && path.endsWith("/order")) schema = orderSchema;
      else throw new Error(`Unsupported local response boundary: ${path}`);
  }
  return schema.parse(value);
}

const operationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending"), request: z.json() }).passthrough(),
  z.object({ status: z.literal("applied"), request: z.json(), result: z.json() }).passthrough(),
  z.object({ status: z.literal("rejected"), request: z.json(), error: z.object({ status: z.number().int().min(400).max(499).refine((value) => ![408, 429].includes(value)), message: z.string() }).passthrough() }).passthrough(),
]);
const cacheSchema = materialReceiptSchema.extend({
  digest: hash, revision: hash.optional(), defaultAccess: z.enum(["free", "membership"]).optional(),
  primaryVideoId: z.uuid().nullable().optional(),
  url: z.string().startsWith("/materials/").refine((value) => value.slice("/materials/".length).length > 0 && !value.slice("/materials/".length).includes("/")).optional(),
});
const journalSchema = z.object({
  schemaVersion: z.literal(1), target: text,
  materials: z.record(text, cacheSchema), guides: z.record(text, z.json()),
  operations: z.record(text, z.union([operationSchema, assetReceiptSchema])),
  lastReport: z.json().optional(),
}).passthrough();

export function parseJournal(value) {
  const journal = journalSchema.parse(value);
  for (const [key, entry] of Object.entries(journal.operations)) {
    if (key.startsWith("image:")) { assetReceiptSchema.parse(entry); continue; }
    const operation = operationSchema.parse(entry);
    if (key !== `authoring:${checksum(canonical(operation.request))}`) throw new Error("Journal request fingerprint mismatch");
    if (operation.request?.path === "/authoring/import/materials/apply") {
      applyBodySchema.parse(operation.request.body);
      if (operation.status === "applied") {
        const receipt = materialReceiptSchema.parse(operation.result);
        if (receipt.materialId !== operation.request.body.materialId) throw new Error("Journal receipt Material identity mismatch");
      }
    }
  }
  return journal;
}
