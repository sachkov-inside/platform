import { z } from "zod";
// @ts-check
import { practiceDefinitionSchema } from "../../apps/backend/src/modules/materials/domain/practice-requirements-schema.ts";
import {
  taskCodeSchema,
  taskDefinitionSchema,
} from "../../apps/backend/src/modules/product-tasks/domain/task-definition-schema.ts";
import { loadPackage } from "./package.mjs";

/** A legacy package is read without rewriting its bytes or Content originals. New writes use
 * the one Task importer; ambiguous ownership must be resolved explicitly before any effect.
 * @param {import('./package.mjs').Manifest} original
 * @returns {import('./package.mjs').Manifest} */
export function migratePracticeRequirements(original) {
  if (!(original.practiceDefinitions ?? []).length) return original;
  const manifest = structuredClone(original);
  const tasks = (manifest.tasks ??= []);
  for (const practice of manifest.practiceDefinitions ?? []) {
    const definition = practiceDefinitionSchema.parse(practice.definition);
    const material = manifest.materials.find(
      (row) =>
        `${manifest.sourceNamespace}:${row.sourceId}` ===
        practice.sourceReference.materialSourceId,
    );
    const owners = manifest.products.flatMap((product) =>
      product.chapters.flatMap((chapter) =>
        chapter.materialIds.includes(material?.sourceId ?? "")
          ? [{ product, chapter }]
          : [],
      ),
    );
    const owner = owners[0];
    if (material === undefined || owners.length !== 1 || owner === undefined)
      throw new Error(
        `${practice.practiceId}: legacy requirements need one explicit Product/chapter binding; originals remain unchanged`,
      );
    if (!practice.practiceId.startsWith(`${manifest.sourceNamespace}:`))
      throw new Error(
        `${practice.practiceId}: legacy identity belongs to another source namespace`,
      );
    const code = taskCodeSchema.parse(
      practice.practiceId.slice(manifest.sourceNamespace.length + 1),
    );
    const converted = taskDefinitionSchema.parse({
      schemaVersion: 1,
      situation: definition.businessInputs,
      result: [definition.expectedOutcome],
      freedom: definition.allowedFreedom,
      criteria: definition.criteria.map((criterion) => ({
        ...criterion,
        level: "required",
      })),
    });
    const existing = tasks.find((task) => task.sourceId === code);
    if (existing !== undefined || material.practiceTaskId !== undefined)
      throw new Error(
        `${practice.practiceId}: reconcile the existing Task/source binding explicitly; immutable versions are not replaced by a legacy definition`,
      );
    if (manifest.materials.some((row) => row.sourceId === code))
      throw new Error(
        `${practice.practiceId}: legacy identity conflicts with a Material identity`,
      );
    tasks.push({
      sourceId: code,
      productId: owner.product.sourceId,
      chapterId: owner.chapter.sourceId,
      title: definition.title,
      access: material.access,
      definition: z.record(z.string(), z.json()).parse(converted),
      relatedMaterialIds: [material.sourceId],
      programmeVisibility: "embedded",
      publicationState: practice.publicationState,
      provenance: practice.provenance,
    });
    material.practiceTaskId = code;
  }
  manifest.practiceDefinitions = [];
  manifest.selection.taskIds = tasks.map((task) => task.sourceId);
  return manifest;
}

/** Keep the source package fingerprint and original legacy records beside the executable Task plan.
 * @param {string} path */
export async function loadTaskPackage(path) {
  const original = await loadPackage(path);
  return {
    ...original,
    manifest: migratePracticeRequirements(original.manifest),
    legacyPractices: original.manifest.practiceDefinitions ?? [],
  };
}
