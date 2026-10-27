// @ts-check
import { z } from "zod";
import {
  canonical,
  checksum,
  manifestSchema,
  materialRevision,
  sourcePracticeSchema,
} from "./package.mjs";
import { sourceUuid } from "./markdown.mjs";
import { isJournalOperation, parseLocalResponse } from "./local-boundaries.mjs";
import { readNamespaceState } from "./preservation-state.mjs";
import { authoredTaskBody } from "./task-import.mjs";

const packageSchema = z.object({
  manifest: manifestSchema,
  legacyPractices: z.array(sourcePracticeSchema).default([]),
});

/** Refuse a legacy conversion that would rewrite an existing Task. A proven identical
 * definition keeps the target's current metadata, version and publication unchanged.
 * @param {unknown} input
 * @param {import('./target.mjs').LocalTransport} send
 * @returns {Promise<ReadonlySet<string>>} */
export async function assertLegacyTaskTargets(input, send) {
  const { manifest, legacyPractices } = packageSchema.parse(input);
  const preserved = new Set();
  if (legacyPractices.length === 0) return preserved;
  const state = await readNamespaceState(send, manifest.sourceNamespace);
  for (const practice of legacyPractices) {
    const code = practice.practiceId.slice(manifest.sourceNamespace.length + 1);
    const matches = state.tasks.filter(
      (row) => row.sourceId === practice.practiceId || row.code === code,
    );
    if (matches.length === 0) continue;
    const current = matches[0];
    const task = manifest.tasks?.find((row) => row.sourceId === code);
    const material = state.materials.find(
      (row) => row.sourceId === practice.sourceReference.materialSourceId,
    );
    const authoredMaterial = manifest.materials.find(
      (row) =>
        `${manifest.sourceNamespace}:${row.sourceId}` ===
        practice.sourceReference.materialSourceId,
    );
    const productsPath = "/authoring/collections?kind=product";
    const products = parseLocalResponse(productsPath, await send(productsPath));
    const product = products.find(
      (row) =>
        row.sourceId === `${manifest.sourceNamespace}:${task?.productId}`,
    );
    const memberships = new Set(
      material?.memberships.map((row) => `${row.productId}:${row.chapterId}`),
    );
    if (
      matches.length !== 1 ||
      current === undefined ||
      task === undefined ||
      material === undefined ||
      authoredMaterial === undefined ||
      product === undefined ||
      current.sourceId !== practice.practiceId ||
      current.code !== code ||
      current.programmeVisibility !== "embedded" ||
      current.embeddedMaterialId !== material.materialId ||
      current.productId !== product.id ||
      current.chapterId !==
        sourceUuid(
          `${manifest.sourceNamespace}:${task.productId}:chapter:${task.chapterId}`,
        ) ||
      memberships.size !== 1 ||
      !memberships.has(`${current.productId}:${current.chapterId}`) ||
      ![
        practice.sourceReference.materialSourceRevision,
        materialRevision(manifest, authoredMaterial),
      ].includes(material.source.revision)
    )
      throw new Error(
        `${practice.practiceId}: existing Task ownership/source binding conflicts with legacy requirements; reconcile explicitly`,
      );
    const path = "/authoring/import/tasks/validate";
    const validated = parseLocalResponse(
      path,
      await send(path, authoredTaskBody(manifest, task, task.publicationState)),
    );
    if (
      validated.migration != null ||
      validated.current?.taskId !== current.taskId ||
      validated.current.definitionDigest !==
        checksum(canonical(task.definition))
    )
      throw new Error(
        `${practice.practiceId}: existing Task definition differs; legacy requirements cannot replace its immutable current version`,
      );
    preserved.add(code);
  }
  return preserved;
}

/** An uncertain old command must be reconciled explicitly, rather than replayed over a
 * Task that this conversion has promised to preserve.
 * @param {import('./journal.mjs').Journal} journal
 * @param {ReadonlySet<string>} preserved */
export function assertLegacyTaskReplay(journal, preserved) {
  const taskCommand = z.object({
    path: z.literal("/authoring/import/tasks/apply"),
    body: z.object({ code: z.string() }),
  });
  for (const entry of Object.values(journal.operations)) {
    if (!isJournalOperation(entry) || entry.status !== "pending") continue;
    const parsed = taskCommand.safeParse(entry.request);
    if (parsed.success && preserved.has(parsed.data.body.code))
      throw new Error(
        `${parsed.data.body.code}: reconcile the uncertain Task command before preserving legacy requirements`,
      );
  }
}
