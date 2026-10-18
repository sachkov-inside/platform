// @ts-check
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  canonical,
  checksum,
  loadPackage,
  isProductShell,
} from "./package.mjs";
import { withJournal, applyJournaled, writeAtomic } from "./journal.mjs";
import {
  isJournalOperation,
  materialReceiptSchema,
} from "./local-boundaries.mjs";
import {
  assertTargetEnvironment,
  authoringTarget,
  transportFor,
  failureStatus,
} from "./target.mjs";

const sourceSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    revision: z.hash("sha256"),
    showInFeed: z.boolean(),
  })
  .strict();
const legacyPracticeSchema = z
  .object({
    practiceId: z.string().min(1),
    practiceVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    definitionDigest: z.hash("sha256"),
  })
  .strict();
const snapshotSchema = z
  .object({
    legacyPractices: z.array(legacyPracticeSchema).max(100).optional(),
    materialId: z.uuid(),
    contentVersion: z.number().int().positive(),
    publicationState: z.enum(["published", "unpublished", "draft"]),
    firstPublishedAt: z.iso.datetime().nullable(),
    primaryVideoId: z.uuid().nullable(),
    source: sourceSchema,
    metadata: z
      .object({
        title: z.string().nullable(),
        summary: z.string().nullable(),
        access: z.enum(["free", "closed"]),
        difficulty: z.enum(["basic", "intermediate", "advanced"]).nullable(),
        outcomes: z.array(z.string()),
        topicId: z.uuid().nullable(),
        formatId: z.string().nullable(),
        tagIds: z.array(z.uuid()),
        seriesMemberships: z.array(
          z
            .object({
              seriesId: z.uuid(),
              ordinal: z.number().int().positive(),
            })
            .strict(),
        ),
      })
      .passthrough(),
    body: z.json(),
  })
  .passthrough();
const protectedSchema = z
  .object({
    sourceId: z.string(),
    materialId: z.uuid(),
    contentVersion: z.number().int().positive(),
  })
  .strict();
export const retirementPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.enum(["material-retirement", "source-draft-deletion"]),
    target: z.string(),
    environment: z.string(),
    packageId: z.hash("sha256"),
    packagePath: z.string(),
    protected: z.array(protectedSchema).min(1),
    materials: z.array(snapshotSchema).min(1).max(100),
    fingerprint: z.hash("sha256"),
  })
  .strict();

/** @typedef {z.infer<typeof retirementPreviewSchema>} RetirementPreview */
/** @typedef {import("./target.mjs").LocalTransport} Transport */

/** @param {z.infer<typeof snapshotSchema>} row @param {string} namespace @param {boolean} deleting */
function eligible(row, namespace, deleting) {
  const owned =
    row.source.id.startsWith(`${namespace}:`) ||
    (deleting && row.source.id.startsWith(`inside-task-page:${namespace}:`));
  return (
    owned &&
    (deleting
      ? row.legacyPractices !== undefined &&
        row.publicationState === "draft" &&
        row.firstPublishedAt === null &&
        row.primaryVideoId === null &&
        row.metadata.seriesMemberships.length === 0
      : row.publicationState !== "draft")
  );
}

/** @param {Awaited<ReturnType<typeof loadPackage>>} pkg */
function protectedSourceIds(pkg) {
  if (
    isProductShell(pkg.manifest) ||
    pkg.manifest.products.length !== 1 ||
    pkg.manifest.selection.productId === null ||
    pkg.manifest.products[0]?.complete !== true
  )
    throw new Error("Retirement needs a complete canonical Product package");
  return pkg.manifest.materials
    .map((row) => `${pkg.manifest.sourceNamespace}:${row.sourceId}`)
    .sort();
}

/** @param {Transport} request @param {string} materialId */
async function load(request, materialId) {
  const current = snapshotSchema.parse(
    await request(`/authoring/materials/${materialId}`),
  );
  if (current.materialId !== materialId)
    throw new Error("Material identity mismatch");
  return current;
}

/** @param {Transport} request @param {ReturnType<typeof authoringTarget>} target */
async function checkEnvironment(request, target) {
  const environment = z
    .object({ mode: z.enum(["development", "test", "production"]) })
    .parse(await request("/authoring/import/materials/environment"));
  assertTargetEnvironment(target, environment.mode);
  return environment.mode;
}

/** Read-only production comparison; missing journal history is never invented.
 * @param {string} packagePath @param {string} state
 * @param {{ origin: string; materialIds: string[]; deleteDrafts?: boolean; request?: Transport | undefined; accessToken?: import("./target.mjs").AccessToken | undefined }} options
 */
export async function previewRetirement(packagePath, state, options) {
  const target = authoringTarget(options.origin);
  const request = options.request ?? transportFor(target, options.accessToken);
  const pkg = await loadPackage(packagePath);
  const keep = protectedSourceIds(pkg);
  const ids = z
    .array(z.uuid())
    .min(1)
    .max(100)
    .parse(options.materialIds)
    .sort();
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate retirement target");
  const environment = await checkEnvironment(request, target);
  return withJournal(state, target.id, async ({ journal }) => {
    const protectedMaterials = [];
    for (const sourceId of keep) {
      const entry = journal.materials[sourceId];
      if (!entry)
        throw new Error(
          `Canonical Material has no recorded identity: ${sourceId}`,
        );
      const current = await load(request, entry.materialId);
      if (current.source.id !== sourceId)
        throw new Error("Canonical source identity mismatch");
      protectedMaterials.push({
        sourceId,
        materialId: current.materialId,
        contentVersion: current.contentVersion,
      });
    }
    const materials = [];
    for (const id of ids) {
      const current = await load(request, id);
      if (
        keep.includes(current.source.id) ||
        protectedMaterials.some((row) => row.materialId === id)
      )
        throw new Error("Cannot retire a canonical Material");
      if (
        !eligible(
          current,
          pkg.manifest.sourceNamespace,
          options.deleteDrafts === true,
        )
      )
        throw new Error(
          "Retirement namespace, draft lifecycle, video or membership is outside scope",
        );
      materials.push(current);
    }
    const plan = {
      schemaVersion: 1,
      scope:
        options.deleteDrafts === true
          ? "source-draft-deletion"
          : "material-retirement",
      target: target.id,
      environment,
      packageId: pkg.id,
      packagePath: resolve(packagePath),
      protected: protectedMaterials,
      materials,
    };
    const preview = retirementPreviewSchema.parse({
      ...plan,
      fingerprint: checksum(canonical(plan)),
    });
    const directory = join(resolve(state), "previews");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `${preview.fingerprint}.json`);
    await writeAtomic(path, preview);
    return { path, preview };
  });
}

/** The reviewed plan is part of the operation identity. A definitive older rejection is retained;
 * a lost response to this exact reviewed retirement always reuses this operation and key.
 * @param {RetirementPreview} preview @param {z.infer<typeof snapshotSchema>} material */
function operation(preview, material) {
  if (preview.scope === "source-draft-deletion")
    return {
      reviewedRetirement: preview.fingerprint,
      path: "/authoring/import/materials/delete-draft",
      body: {
        expectedLegacyPractices: material.legacyPractices ?? [],
        sourceId: material.source.id,
        materialId: material.materialId,
        expectedContentVersion: material.contentVersion,
      },
    };
  const { seriesMemberships, ...metadata } = material.metadata;
  return {
    reviewedRetirement: preview.fingerprint,
    path: "/authoring/import/materials/apply",
    body: {
      source: material.source,
      materialId: material.materialId,
      expectedContentVersion: material.contentVersion,
      publicationState: "unpublished",
      primaryVideoId: material.primaryVideoId,
      metadata: {
        title: metadata.title,
        summary: metadata.summary,
        access: metadata.access,
        difficulty: metadata.difficulty,
        outcomes: metadata.outcomes,
        topicId: metadata.topicId,
        formatId: metadata.formatId,
        tagIds: metadata.tagIds,
        seriesIds: seriesMemberships.map((row) => row.seriesId),
      },
      body: material.body,
    },
  };
}

/** @param {string} previewPath @param {string} state
 * @param {{request?: Transport | undefined; accessToken?: import("./target.mjs").AccessToken | undefined}} [options] */
export async function applyRetirement(previewPath, state, options = {}) {
  const preview = retirementPreviewSchema.parse(
    JSON.parse(await readFile(previewPath, "utf8")),
  );
  const { fingerprint, ...plan } = preview;
  if (checksum(canonical(plan)) !== fingerprint)
    throw new Error("Preview file was changed after review");
  const target = authoringTarget(preview.target);
  const request = options.request ?? transportFor(target, options.accessToken);
  if ((await checkEnvironment(request, target)) !== preview.environment)
    throw new Error("Retirement environment changed");
  const pkg = await loadPackage(preview.packagePath);
  const keep = protectedSourceIds(pkg);
  if (
    pkg.id !== preview.packageId ||
    canonical(keep) !==
      canonical(preview.protected.map((row) => row.sourceId).sort())
  )
    throw new Error("Canonical package differs from the reviewed preview");
  for (const row of preview.materials) {
    if (
      keep.includes(row.source.id) ||
      preview.protected.some((item) => item.materialId === row.materialId) ||
      !eligible(
        row,
        pkg.manifest.sourceNamespace,
        preview.scope === "source-draft-deletion",
      )
    )
      throw new Error("Retirement target is outside reviewed scope");
  }
  return withJournal(state, target.id, async (context) => {
    const send = async (
      /** @type {ReturnType<typeof operation>} */ action,
      /** @type {string} */ key,
    ) => {
      if (action.path === "/authoring/import/materials/delete-draft") {
        const receipt = z
          .object({ materialId: z.uuid() })
          .strict()
          .parse(await request(action.path, action.body, key));
        if (receipt.materialId !== action.body.materialId)
          throw new Error("Deleted source identity mismatch");
        return receipt;
      }
      const receipt = materialReceiptSchema
        .extend({ publicationState: z.literal("unpublished") })
        .parse(await request(action.path, action.body, key));
      if (
        receipt.materialId !== action.body.materialId ||
        receipt.contentVersion !== action.body.expectedContentVersion + 1
      )
        throw new Error("Retirement receipt identity or version mismatch");
      return receipt;
    };
    // Finish only already-started operations from this exact plan. Never replay foreign work.
    for (const entry of Object.values(context.journal.operations)) {
      if (!isJournalOperation(entry) || entry.status !== "pending") continue;
      const action = z
        .object({ reviewedRetirement: z.string() })
        .passthrough()
        .safeParse(entry.request);
      if (!action.success || action.data.reviewedRetirement !== fingerprint)
        throw new Error(
          "Finish pending authoring operations before this retirement",
        );
      const original = preview.materials.find(
        (row) =>
          canonical(operation(preview, row)) === canonical(entry.request),
      );
      if (!original)
        throw new Error("Pending retirement does not match its reviewed plan");
      await applyJournaled(context, operation(preview, original), send);
    }
    // Recheck the entire plan, including every protected Material, before the first new write.
    for (const row of preview.protected) {
      const current = await load(request, row.materialId);
      if (
        current.source.id !== row.sourceId ||
        current.contentVersion !== row.contentVersion
      )
        throw new Error(
          "Canonical Materials changed after preview; preview again",
        );
    }
    for (const row of preview.materials) {
      const action = operation(preview, row);
      const entry =
        context.journal.operations[`authoring:${checksum(canonical(action))}`];
      const completed = isJournalOperation(entry) && entry.status === "applied";
      if (preview.scope === "source-draft-deletion" && completed) {
        const receipt = z
          .object({ materialId: z.uuid() })
          .strict()
          .parse(entry.result);
        if (receipt.materialId !== row.materialId)
          throw new Error("Deleted source identity mismatch");
        try {
          await load(request, row.materialId);
        } catch (error) {
          if (failureStatus(error) === 404) continue;
          throw error;
        }
        throw new Error("Deleted source Material unexpectedly exists");
      }
      const current = await load(request, row.materialId);
      const ownReceipt =
        isJournalOperation(entry) && entry.status === "applied"
          ? materialReceiptSchema.parse(entry.result)
          : null;
      const expected =
        ownReceipt === null
          ? row
          : {
              ...row,
              contentVersion: ownReceipt.contentVersion,
              publicationState: "unpublished",
            };
      if (canonical(current) !== canonical(expected))
        throw new Error(
          "Retirement target changed after preview; preview again",
        );
    }
    /** @type {{sourceId: string}[]} */
    const archived = [];
    /** @type {{sourceId: string}[]} */
    const deleted = [];
    for (const row of preview.materials) {
      if (row.publicationState !== "unpublished") {
        const result = await applyJournaled(
          context,
          operation(preview, row),
          send,
        );
        const savedVersion =
          preview.scope === "source-draft-deletion"
            ? row.contentVersion
            : materialReceiptSchema.parse(result).contentVersion;
        const entry = context.journal.materials[row.source.id];
        if (entry?.materialId === row.materialId) {
          Object.assign(entry, {
            contentVersion: savedVersion,
            archived: true,
          });
          await context.persist();
        }
      }
      (preview.scope === "source-draft-deletion" ? deleted : archived).push({
        sourceId: row.source.id,
      });
    }
    return {
      scope: preview.scope,
      applied: archived.length + deleted.length,
      unchanged: 0,
      archived,
      deleted,
      products: [],
      tasks: [],
    };
  });
}
