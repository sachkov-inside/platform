// @ts-check
import { z } from "zod";
import { canonical, checksum, sourcePracticeSchema } from "./package.mjs";
import { applyJournaled } from "./journal.mjs";
import {
  isJournalOperation,
  practiceReceiptSchema,
} from "./local-boundaries.mjs";

const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const applyBody = sourcePracticeSchema
  .extend({
    materialId: z.uuid(),
    expectedContentVersion: version,
    expectedPracticeVersion: version.nullable(),
  })
  .strict();
const operationSchema = z
  .object({
    path: z.literal("/authoring/import/practices/apply"),
    body: applyBody,
  })
  .strict();
const storedSchema = z
  .object({ practiceVersion: version, digest: z.hash("sha256") })
  .strict();

/** @param {z.infer<typeof applyBody>} body */
function digest(body) {
  const { expectedPracticeVersion: _cas, ...state } = body;
  return checksum(canonical(state));
}

/** @param {import('./package.mjs').Manifest} manifest
 * @param {import('./local-boundaries.mjs').LocalRequest} request */
export async function validateSourcePractices(manifest, request) {
  for (const definition of manifest.practiceDefinitions ?? [])
    await request("/authoring/import/practices/validate", definition);
}

/** Recover an uncertain request before reading current versions; never invent another key.
 * @param {import('./journal.mjs').JournalContext} context
 * @param {import('./local-boundaries.mjs').LocalRequest} request */
export async function replayPracticeImports(context, request) {
  const resources = (context.journal.resources ??= {});
  for (const entry of Object.values(context.journal.operations)) {
    if (!isJournalOperation(entry) || entry.status === "rejected") continue;
    const parsed = operationSchema.safeParse(entry.request);
    if (!parsed.success) continue;
    const operation = parsed.data;
    const key = `practice:${operation.body.practiceId}`;
    const previous =
      resources[key] === undefined
        ? undefined
        : storedSchema.parse(resources[key]);
    if (
      entry.status === "applied" &&
      previous !== undefined &&
      previous.practiceVersion >=
        practiceReceiptSchema.parse(entry.result).practiceVersion
    )
      continue;
    const receipt = practiceReceiptSchema.parse(
      await applyJournaled(context, operation, (replayed, idempotencyKey) =>
        request(replayed.path, replayed.body, idempotencyKey),
      ),
    );
    resources[key] = {
      practiceVersion: receipt.practiceVersion,
      digest: digest(operation.body),
    };
    await context.persist();
  }
}

/**
 * Practice context follows its lesson (#804): a private draft never carries a published practice.
 *
 * @param {import('./package.mjs').Manifest} manifest
 * @param {(materialSourceId: string) => "draft" | "published"} publicationOf
 * @returns {import('./package.mjs').Manifest}
 */
export function practicesFollowLessons(manifest, publicationOf) {
  if (manifest.practiceDefinitions === undefined) return manifest;
  return {
    ...manifest,
    practiceDefinitions: manifest.practiceDefinitions.map((definition) =>
      publicationOf(definition.sourceReference.materialSourceId) === "draft"
        ? { ...definition, publicationState: "unpublished" }
        : definition,
    ),
  };
}

/** Absence is a no-op; publicationState is the explicit full-state decision of the package.
 * @param {import('./package.mjs').Manifest} manifest
 * @param {import('./journal.mjs').JournalContext} context
 * @param {import('./local-boundaries.mjs').LocalRequest} request */
export async function syncSourcePractices(manifest, context, request) {
  const resources = (context.journal.resources ??= {});
  for (const definition of manifest.practiceDefinitions ?? []) {
    const material =
      context.journal.materials[definition.sourceReference.materialSourceId];
    if (
      material === undefined ||
      material.revision !== definition.sourceReference.materialSourceRevision
    )
      throw new Error(
        `${definition.practiceId}: lesson source was not synchronized`,
      );
    const { current } = await request(
      "/authoring/import/practices/validate",
      definition,
    );
    const key = `practice:${definition.practiceId}`;
    const previous =
      resources[key] === undefined
        ? undefined
        : storedSchema.parse(resources[key]);
    if (
      previous !== undefined &&
      previous.practiceVersion !== current?.practiceVersion
    )
      throw new Error(
        `${definition.practiceId}: target changed; reconcile before overwriting`,
      );
    const body = {
      ...definition,
      materialId: material.materialId,
      expectedContentVersion: material.contentVersion,
      expectedPracticeVersion: current?.practiceVersion ?? null,
    };
    const desired = digest(body);
    if (previous?.digest === desired) continue;
    const receipt = practiceReceiptSchema.parse(
      await applyJournaled(
        context,
        { path: "/authoring/import/practices/apply", body },
        (operation, idempotencyKey) =>
          request(operation.path, operation.body, idempotencyKey),
      ),
    );
    resources[key] = {
      practiceVersion: receipt.practiceVersion,
      digest: desired,
    };
    await context.persist();
  }
}
