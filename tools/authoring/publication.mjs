// @ts-check
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { canonical, checksum } from "./package.mjs";
import { applyJournaled, withJournal, writeAtomic } from "./journal.mjs";
import {
  isJournalOperation,
  materialReceiptSchema,
} from "./local-boundaries.mjs";
import {
  assertTargetEnvironment,
  authoringTarget,
  transportFor,
} from "./target.mjs";

const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const state = z.enum(["published", "unpublished"]);
const identity = z.object({
  materialId: z.uuid(),
  contentVersion: version,
  publicationState: z.enum(["draft", "published", "unpublished"]),
  source: z.object({ id: z.string().min(1) }),
  metadata: z.object({ title: z.string().nullable() }),
});
const previewSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.literal("material-publication"),
    target: z.string(),
    environment: z.string(),
    materialId: z.uuid(),
    sourceId: z.string().trim().min(1).max(200),
    expectedContentVersion: version,
    publicationState: state,
    from: z.enum(["draft", "published", "unpublished"]),
    title: z.string().nullable(),
    confirmedProductRemovals: z.array(z.uuid()).max(100),
    fingerprint: z.hash("sha256"),
  })
  .strict();
/** @typedef {import('./target.mjs').LocalTransport} Transport */

/** No package path or desired content exists in a publication plan.
 * @param {string} directory
 * @param {{origin: string; materialId: string; sourceId: string; publicationState: "published" | "unpublished"; confirmedProductRemovals?: string[]; request?: Transport | undefined; accessToken?: import('./target.mjs').AccessToken | undefined}} options */
export async function previewPublication(directory, options) {
  const target = authoringTarget(options.origin);
  const request = options.request ?? transportFor(target, options.accessToken);
  const environment = z
    .object({ mode: z.enum(["development", "test", "production"]) })
    .parse(await request("/authoring/import/materials/environment"));
  assertTargetEnvironment(target, environment.mode);
  const materialId = z.uuid().parse(options.materialId);
  const current = identity.parse(
    await request(`/authoring/materials/${materialId}`),
  );
  if (
    current.materialId !== materialId ||
    current.source.id !== options.sourceId
  )
    throw new Error("Publication source identity mismatch");
  const plan = {
    schemaVersion: /** @type {const} */ (1),
    scope: /** @type {const} */ ("material-publication"),
    target: target.id,
    environment: environment.mode,
    materialId,
    sourceId: options.sourceId,
    expectedContentVersion: current.contentVersion,
    publicationState: options.publicationState,
    from: current.publicationState,
    title: current.metadata.title,
    confirmedProductRemovals: [
      ...new Set(options.confirmedProductRemovals ?? []),
    ].sort(),
  };
  const preview = previewSchema.parse({
    ...plan,
    fingerprint: checksum(canonical(plan)),
  });
  await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
  const path = join(
    resolve(directory),
    `publication-${preview.fingerprint}.json`,
  );
  await writeAtomic(path, preview);
  return { path, preview };
}

/** @param {string} previewPath @param {string} directory
 * @param {{request?: Transport | undefined; accessToken?: import('./target.mjs').AccessToken | undefined}} [options] */
export async function applyPublication(previewPath, directory, options = {}) {
  const preview = previewSchema.parse(
    JSON.parse(await readFile(previewPath, "utf8")),
  );
  const { fingerprint, ...plan } = preview;
  if (checksum(canonical(plan)) !== fingerprint)
    throw new Error("Preview file was changed after review");
  const target = authoringTarget(preview.target);
  const request = options.request ?? transportFor(target, options.accessToken);
  const environment = z
    .object({ mode: z.enum(["development", "test", "production"]) })
    .parse(await request("/authoring/import/materials/environment"));
  assertTargetEnvironment(target, environment.mode);
  if (preview.environment !== environment.mode)
    throw new Error("Publication environment changed");
  const operation = {
    path: "/authoring/import/materials/publication",
    body: {
      materialId: preview.materialId,
      sourceId: preview.sourceId,
      expectedContentVersion: preview.expectedContentVersion,
      publicationState: preview.publicationState,
      confirmedProductRemovals: preview.confirmedProductRemovals,
    },
  };
  return withJournal(directory, target.id, async (context) => {
    for (const entry of Object.values(context.journal.operations)) {
      if (
        isJournalOperation(entry) &&
        entry.status === "pending" &&
        canonical(entry.request) !== canonical(operation)
      )
        throw new Error(
          "Finish pending authoring operations before publication",
        );
    }
    const key = `authoring:${checksum(canonical(operation))}`;
    // An uncertain or completed request reuses the exact command/key, even after a later edit.
    // A new request rechecks identity/version before the server's transactional CAS.
    if (context.journal.operations[key] === undefined) {
      const current = identity.parse(
        await request(`/authoring/materials/${preview.materialId}`),
      );
      if (
        current.materialId !== preview.materialId ||
        current.source.id !== preview.sourceId ||
        current.contentVersion !== preview.expectedContentVersion
      )
        throw new Error(
          "Publication target changed after preview; preview again",
        );
    }
    const receipt = materialReceiptSchema
      .extend({ publicationState: state })
      .parse(
        await applyJournaled(context, operation, (action, key) =>
          request(action.path, action.body, key),
        ),
      );
    if (
      receipt.materialId !== preview.materialId ||
      receipt.contentVersion !== preview.expectedContentVersion + 1 ||
      receipt.publicationState !== preview.publicationState
    )
      throw new Error(
        "Publication receipt identity, version or status mismatch",
      );
    const material = context.journal.materials[preview.sourceId];
    if (
      material?.materialId === preview.materialId &&
      material.contentVersion === preview.expectedContentVersion
    ) {
      material.contentVersion = receipt.contentVersion;
      material.archived = receipt.publicationState === "unpublished";
      await context.persist();
    }
    return {
      scope: preview.scope,
      applied: 1,
      unchanged: 0,
      archived: [],
      products: [],
      tasks: [],
      receipt,
    };
  });
}
