// @ts-check
import { z } from "zod";
import { canonical, checksum } from "./package.mjs";

const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const text = z.string().min(1);
const hash = z.hash("sha256");
const access = z.enum(["free", "membership", "workshop"]);
/** @typedef {z.infer<typeof access>} Access */
// Validate consumed fields, preserving additional wire fields and exact replay bytes.
const source = z
  .object({ id: text, path: text, revision: hash, showInFeed: z.boolean() })
  .passthrough();
export const materialReceiptSchema = z
  .object({ materialId: z.uuid(), contentVersion: version })
  .passthrough();
const coverSchema = z.object({ coverId: z.uuid() }).passthrough();
const materialSchema = materialReceiptSchema.extend({
  primaryVideoId: z.uuid().nullable(),
  metadata: z
    .object({
      slug: text,
      access: access.optional(),
    })
    .passthrough(),
  source: source.nullable(),
  cover: coverSchema.nullable().optional(),
});
const topicSchema = z.object({ id: z.uuid(), slug: text }).passthrough();
const guideSchema = topicSchema.extend({
  name: z.string(),
  summary: z.string(),
  version,
  archived: z.boolean().optional(),
  presentation: z.string().nullable().optional(),
  page: z.json().nullable().optional(),
  pageRejected: z.boolean().optional(),
  sourceId: z.string().nullable().optional(),
});
/** @typedef {z.infer<typeof guideSchema>} StoredGuide */
const coverChangeSchema = z
  .object({ cover: coverSchema.nullable() })
  .passthrough();
const artifactOutcomeSchema = z
  .object({
    artifactId: z.uuid(),
    outcome: z.enum(["created", "diverged", "missing", "unchanged", "updated"]),
    sourceId: z.string().nullable(),
    title: z.string(),
  })
  .passthrough();
const artifactSchema = z
  .object({
    artifactId: z.uuid(),
    materialIds: z.array(z.uuid()),
    origin: z.enum(["authoring", "platform"]),
    sourceId: z.string().nullable(),
    title: z.string(),
  })
  .passthrough();
export const videoSchema = z
  .object({
    videoId: z.uuid(),
    materialId: z.uuid(),
    state: z.enum([
      "uploading",
      "processing",
      "ready",
      "failed",
      "deletion_requested",
      "deleting",
      "deleted",
      "delete_failed",
    ]),
    durationSeconds: z.number().int().positive().optional(),
  })
  .passthrough();
/** @typedef {z.infer<typeof videoSchema>} Video */
const videoUploadSchema = z
  .object({
    uploadEndpoint: z.url(),
    providerVideoId: text,
    video: videoSchema,
  })
  .passthrough();
const orderSchema = z.object({ orderVersion: hash }).passthrough();
const guideOrderSchema = orderSchema.extend({
  items: z.array(
    z
      .object({ materialId: z.uuid(), chapterId: z.uuid().nullable() })
      .passthrough(),
  ),
  chapters: z.array(
    z
      .object({ id: z.uuid(), name: z.string(), summary: z.string() })
      .passthrough(),
  ),
});
export const assetReceiptSchema = z.object({ assetId: z.uuid() }).passthrough();
const applyBodySchema = z
  .object({
    source,
    materialId: z.uuid(),
    expectedContentVersion: version,
    publicationState: z.enum(["draft", "published", "unpublished"]),
    metadata: z
      .object({
        title: z.string().nullable(),
        summary: z.string().nullable(),
        access,
        difficulty: z.enum(["basic", "intermediate", "advanced"]).nullable(),
        outcomes: z.array(z.string()),
        topicId: z.uuid().nullable(),
        formatId: z.string().nullable(),
        tagIds: z.array(z.uuid()),
        seriesIds: z.array(z.uuid()),
      })
      .passthrough(),
    body: z.object({ schemaVersion: version, doc: z.json() }).passthrough(),
    primaryVideoId: z.uuid().nullable(),
    videoChapters: z
      .array(
        z
          .object({ start: z.number().int().nonnegative(), title: text })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const environmentSchema = z
  .object({ mode: z.enum(["development", "test", "production"]) })
  .passthrough();
const validSchema = z.object({ valid: z.literal(true) }).passthrough();
const homePinSchema = z
  .object({ seriesId: z.uuid().nullable(), version })
  .passthrough();
const guideArtifactsSchema = z
  .object({ artifacts: z.array(artifactSchema) })
  .passthrough();

/** Every response schema of the local API by name; the path of a request selects one. */
export const practiceReceiptSchema = z
  .object({
    practiceId: text,
    practiceVersion: version,
    definitionDigest: hash,
    materialId: z.uuid(),
    boundContentVersion: version,
    publicationState: z.enum(["published", "unpublished"]),
  })
  .strict();
const practiceValidationSchema = z
  .object({ valid: z.literal(true), current: practiceReceiptSchema.nullable() })
  .strict();

const localResponseSchemas = {
  practiceReceipt: practiceReceiptSchema,
  practiceValidation: practiceValidationSchema,
  environment: environmentSchema,
  topics: z.array(topicSchema),
  guides: z.array(guideSchema),
  topic: topicSchema,
  valid: validSchema,
  materialReceipt: materialReceiptSchema,
  guide: guideSchema,
  order: orderSchema,
  homePin: homePinSchema,
  assetReceipt: assetReceiptSchema,
  video: videoSchema,
  videoUpload: videoUploadSchema,
  material: materialSchema,
  coverChange: coverChangeSchema,
  artifactOutcome: artifactOutcomeSchema,
  guideArtifacts: guideArtifactsSchema,
  artifact: artifactSchema,
  guideOrder: guideOrderSchema,
};

/**
 * @typedef {keyof typeof localResponseSchemas} LocalResponseKind
 */

/**
 * The response schema a path selects, written as a type in the order `localResponseKind` tests
 * paths; `local-boundaries.test.mjs` pins both to the same examples.
 *
 * @template {string} P
 * @typedef {P extends "/authoring/import/materials/environment"
 *   ? "environment"
 *   : P extends "/authoring/import/practices/validate"
 *   ? "practiceValidation"
 *   : P extends "/authoring/import/practices/apply"
 *   ? "practiceReceipt"
 *   : P extends "/authoring/collections?kind=topic"
 *   ? "topics"
 *   : P extends "/authoring/collections?kind=guide"
 *   ? "guides"
 *   : P extends "/authoring/collections"
 *   ? "topic"
 *   : P extends "/authoring/import/materials/validate" | "/authoring/import/guides/validate"
 *   ? "valid"
 *   : P extends "/authoring/import/materials/reserve" | "/authoring/import/materials/apply"
 *   ? "materialReceipt"
 *   : P extends "/authoring/import/guides/reserve" | "/authoring/import/guides/update"
 *   ? "guide"
 *   : P extends "/authoring/import/guides/composition"
 *   ? "order"
 *   : P extends "/authoring/home-pin"
 *   ? "homePin"
 *   : P extends `/authoring/materials/${string}/assets`
 *   ? "assetReceipt"
 *   : P extends `/authoring/materials/${string}/videos/attach`
 *   ? "video"
 *   : P extends `/authoring/materials/${string}/videos/uploads`
 *   ? "videoUpload"
 *   : P extends `/authoring/videos/${string}/reconcile`
 *   ? "video"
 *   : P extends `/authoring/materials/${string}`
 *   ? "material"
 *   : P extends `/authoring/import/content-covers/${"material" | "series"}/${string}`
 *   ? "coverChange"
 *   : P extends `/authoring/import/guides/${string}/artifacts`
 *   ? "artifactOutcome"
 *   : P extends `/authoring/guides/${string}/artifacts`
 *   ? "guideArtifacts"
 *   : P extends `/authoring/guide-artifacts/${string}/materials`
 *   ? "artifact"
 *   : P extends `/authoring/guides/${string}/order`
 *   ? "guideOrder"
 *   : never} LocalResponseKindOf
 */

/**
 * The response each local path returns.
 *
 * @template {string} P
 * @typedef {[LocalResponseKindOf<P>] extends [never]
 *   ? unknown
 *   : z.infer<(typeof localResponseSchemas)[LocalResponseKindOf<P>]>} LocalResponse
 */

/**
 * A transport whose response is checked by `parseLocalResponse` for its path.
 *
 * @typedef {<P extends string>(
 *   path: P,
 *   body?: unknown,
 *   key?: string,
 *   options?: { method?: string },
 * ) => Promise<LocalResponse<P>>} LocalRequest
 */

/**
 * The response schema a local path selects.
 *
 * @param {string} path
 * @returns {LocalResponseKind}
 */
export function localResponseKind(path) {
  switch (path) {
    case "/authoring/import/practices/validate":
      return "practiceValidation";
    case "/authoring/import/practices/apply":
      return "practiceReceipt";
    case "/authoring/import/materials/environment":
      return "environment";
    case "/authoring/collections?kind=topic":
      return "topics";
    case "/authoring/collections?kind=guide":
      return "guides";
    case "/authoring/collections":
      return "topic";
    case "/authoring/import/materials/validate":
    case "/authoring/import/guides/validate":
      return "valid";
    case "/authoring/import/materials/reserve":
    case "/authoring/import/materials/apply":
      return "materialReceipt";
    case "/authoring/import/guides/reserve":
    case "/authoring/import/guides/update":
      return "guide";
    case "/authoring/import/guides/composition":
      return "order";
    case "/authoring/home-pin":
      return "homePin";
    default:
      if (/^\/authoring\/materials\/[^/]+\/assets$/u.test(path))
        return "assetReceipt";
      if (/^\/authoring\/materials\/[^/]+\/videos\/attach$/u.test(path))
        return "video";
      if (/^\/authoring\/materials\/[^/]+\/videos\/uploads$/u.test(path))
        return "videoUpload";
      if (/^\/authoring\/videos\/[^/]+\/reconcile$/u.test(path)) return "video";
      if (/^\/authoring\/materials\/[^/]+$/u.test(path)) return "material";
      if (
        /^\/authoring\/import\/content-covers\/(material|series)\/[^/]+$/u.test(
          path,
        )
      )
        return "coverChange";
      if (/^\/authoring\/import\/guides\/[^/]+\/artifacts$/u.test(path))
        return "artifactOutcome";
      if (/^\/authoring\/guides\/[^/]+\/artifacts$/u.test(path))
        return "guideArtifacts";
      if (/^\/authoring\/guide-artifacts\/[^/]+\/materials$/u.test(path))
        return "artifact";
      if (/^\/authoring\/guides\/[^/]+\/order$/u.test(path))
        return "guideOrder";
      throw new Error(`Unsupported local response boundary: ${path}`);
  }
}

/**
 * @template {string} P
 * @overload
 * @param {P} path
 * @param {unknown} value
 * @returns {LocalResponse<P>}
 */
/**
 * @param {string} path
 * @param {unknown} value
 * @returns {unknown}
 */
export function parseLocalResponse(path, value) {
  return localResponseSchemas[localResponseKind(path)].parse(value);
}

// A journal file holds canonical JSON. In memory a request or result may still carry undefined
// fields that canonical() drops on write, so the checked value keeps the type unknown.
/** @type {z.ZodType<unknown>} */
const journalValue = z.custom((value) => z.json().safeParse(value).success);
const operationSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("pending"), request: journalValue })
    .passthrough(),
  z
    .object({
      status: z.literal("applied"),
      request: journalValue,
      result: journalValue,
    })
    .passthrough(),
  z
    .object({
      status: z.literal("rejected"),
      request: journalValue,
      error: z
        .object({
          status: z
            .number()
            .int()
            .min(400)
            .max(499)
            .refine((value) => ![408, 429].includes(value)),
          message: z.string(),
        })
        .passthrough(),
    })
    .passthrough(),
]);
const cacheSchema = materialReceiptSchema.extend({
  digest: hash,
  revision: hash.optional(),
  defaultAccess: z.enum(["free", "membership"]).optional(),
  primaryVideoId: z.uuid().nullable().optional(),
  coverId: z.uuid().nullable().optional(),
  coverSha256: hash.nullable().optional(),
  guideSourceIds: z.array(text).optional(),
  archived: z.boolean().optional(),
  access: access.optional(),
  url: z
    .string()
    .startsWith("/materials/")
    .refine(
      (value) =>
        value.slice("/materials/".length).length > 0 &&
        !value.slice("/materials/".length).includes("/"),
    )
    .optional(),
});
const journalSchema = z
  .object({
    schemaVersion: z.literal(1),
    target: text,
    materials: z.record(text, cacheSchema),
    guides: z.record(
      text,
      z
        .object({ guideId: z.uuid(), slug: text, version: version.optional() })
        .passthrough(),
    ),
    operations: z.record(text, z.union([operationSchema, assetReceiptSchema])),
    // Durable receipts for covers, artifacts and videos; they are not replayable request operations.
    resources: z.record(text, z.json()).optional(),
    lastReport: z.json().optional(),
  })
  .passthrough();

// Receipts under `journal.resources`, one shape per key prefix. They are written by this tool, and
// a reader checks the one it expects before trusting it.
/** `video:<materialId>:<providerVideoId>`: a provider record attached to a Material. */
export const attachedVideoReceiptSchema = z.object({
  videoId: z.uuid(),
  state: videoSchema.shape.state,
});
/** `source-video:<sourceKey>`: the recording `authoring:video` uploaded for an original. */
export const sourceVideoReceiptSchema = z.object({
  videoId: z.uuid(),
  providerVideoId: text,
  sha256: hash,
});
/** `cover-pending:<materialId>`: a cover change whose response may have been lost. */
export const pendingCoverReceiptSchema = z.object({
  sha256: hash,
  expectedCoverId: z.uuid().nullable(),
});
/** `artifact:<guideId>:<sourceKey>`: a Guide artifact and the Materials it was linked to. */
export const artifactReceiptSchema = z.object({
  artifactId: z.uuid(),
  fingerprint: hash,
  materialIds: z.array(z.uuid()).nullable(),
});
const uploadStart = {
  sourceId: text,
  idempotencyKey: text,
  byteSize: z.number().int().positive(),
  filename: text,
  title: z.string(),
  access,
};
const uploadTransfer = {
  ...uploadStart,
  videoId: z.uuid(),
  providerVideoId: text,
  uploadEndpoint: z.url(),
};
/** `upload:<materialId>:<sha256>`: one recording upload, persisted before every step. */
export const uploadReceiptSchema = z.discriminatedUnion("phase", [
  z.object({ ...uploadStart, phase: z.literal("initializing") }),
  z.object({
    ...uploadTransfer,
    phase: z.enum(["transfer", "processing", "failed"]),
  }),
  z.object({
    ...uploadTransfer,
    phase: z.literal("ready"),
    durationSeconds: z.number().int().positive().nullable(),
  }),
]);

/**
 * The receipt stored under a resource key, checked against the shape its prefix names.
 *
 * @template T
 * @param {z.ZodType<T>} schema
 * @param {unknown} value
 * @returns {T | undefined}
 */
export function parseReceipt(schema, value) {
  return value === undefined ? undefined : schema.parse(value);
}

/**
 * A request operation of the journal; image receipts share the record under their own key prefix.
 *
 * @param {unknown} entry
 * @returns {entry is z.infer<typeof operationSchema>}
 */
export function isJournalOperation(entry) {
  return operationSchema.safeParse(entry).success;
}

const materialApplyPath = "/authoring/import/materials/apply";
const materialApplyRequestSchema = z
  .object({ path: z.literal(materialApplyPath), body: applyBodySchema })
  .passthrough();

/**
 * The Material apply command a journal request holds, or undefined for another request.
 *
 * @param {unknown} request
 */
export function materialApplyRequest(request) {
  return typeof request === "object" &&
    request !== null &&
    "path" in request &&
    request.path === materialApplyPath
    ? materialApplyRequestSchema.parse(request)
    : undefined;
}

/** @param {unknown} value */
export function parseJournal(value) {
  const journal = journalSchema.parse(value);
  for (const [key, entry] of Object.entries(journal.operations)) {
    if (key.startsWith("image:")) {
      assetReceiptSchema.parse(entry);
      continue;
    }
    const operation = operationSchema.parse(entry);
    if (key !== `authoring:${checksum(canonical(operation.request))}`)
      throw new Error("Journal request fingerprint mismatch");
    const apply = materialApplyRequest(operation.request);
    if (apply !== undefined) {
      const body = apply.body;
      if (operation.status === "applied") {
        const receipt = materialReceiptSchema.parse(operation.result);
        if (receipt.materialId !== body.materialId)
          throw new Error("Journal receipt Material identity mismatch");
      }
    }
  }
  return journal;
}
