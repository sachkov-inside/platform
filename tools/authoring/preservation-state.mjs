// @ts-check
// The target state a content-only delivery preserves (#1672). It comes from the receiver's
// authenticated state reads, so the stand and production use the same source of truth.
import { z } from "zod";

const access = z.enum(["free", "closed"]);
const commit = z.hash("sha1").nullable();
export const targetStateSchema = z
  .object({
    materials: z.array(
      z
        .object({
          sourceId: z.string().min(1),
          materialId: z.uuid(),
          contentVersion: z.number().int().positive(),
          access,
          publicationState: z.enum(["draft", "published", "unpublished"]),
          sourceRevision: z.hash("sha256").optional(),
          sourceCommit: commit.optional(),
          memberships: z
            .array(
              z
                .object({
                  productId: z.uuid(),
                  ordinal: z.number().int().positive(),
                  chapterId: z.uuid().nullable(),
                })
                .strict(),
            )
            .optional(),
        })
        .strict(),
    ),
    tasks: z.array(
      z
        .object({
          sourceId: z.string().min(1),
          taskId: z.uuid(),
          code: z.string().min(1),
          productId: z.uuid(),
          chapterId: z.uuid().nullable().optional(),
          position: z.number().int().positive().nullable().optional(),
          afterMaterialSourceId: z.string().nullable().optional(),
          programmeVisibility: z
            .enum(["standalone", "embedded", "legacy"])
            .optional(),
          embeddedMaterialId: z.uuid().nullable().optional(),
          revision: z.number().int().positive(),
          access,
          publicationState: z.enum(["published", "unpublished"]),
          sourceCommit: commit.optional(),
        })
        .strict(),
    ),
    // Reader paths of context Materials that the selected bodies may link to, by source key.
    links: z
      .record(z.string(), z.string().startsWith("/materials/"))
      .optional(),
  })
  .strict();

/** @typedef {z.infer<typeof targetStateSchema>} TargetState */
/**
 * @typedef {(
 *   materialIds: string[],
 *   taskIds: string[],
 *   contextMaterialIds?: string[],
 * ) => Promise<TargetState>} ReadTargetState
 */

const identifier = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const materialStateSchema = z
  .object({
    namespace: identifier,
    materials: z.array(
      z
        .object({
          sourceId: z.string().min(1),
          materialId: z.uuid(),
          slug: z.string().min(1).nullable(),
          contentVersion: z.number().int().positive(),
          access,
          publicationState: z.enum(["draft", "published", "unpublished"]),
          source: z
            .object({
              path: z.string().min(1),
              revision: z.hash("sha256"),
              commit,
              showInFeed: z.boolean(),
            })
            .passthrough(),
          memberships: z.array(
            z
              .object({
                productId: z.uuid(),
                ordinal: z.number().int().positive(),
                chapterId: z.uuid().nullable(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const taskStateSchema = z
  .object({
    namespace: identifier,
    tasks: z.array(
      z
        .object({
          sourceId: z.string().min(1),
          taskId: z.uuid(),
          code: z.string().min(1),
          productId: z.uuid(),
          chapterId: z.uuid().nullable(),
          position: z.number().int().positive().nullable(),
          afterMaterialSourceId: z.string().nullable(),
          programmeVisibility: z.enum(["standalone", "embedded", "legacy"]),
          embeddedMaterialId: z.uuid().nullable(),
          revision: z.number().int().positive(),
          access,
          publicationState: z.enum(["published", "unpublished"]),
          sourceCommit: commit,
        })
        .passthrough(),
    ),
  })
  .passthrough();

/**
 * Every source-owned Material and Task of one namespace, as the receiver reports them.
 *
 * @param {import("./target.mjs").LocalTransport} send
 * @param {string} namespace
 */
export async function readNamespaceState(send, namespace) {
  const query = `?namespace=${encodeURIComponent(identifier.parse(namespace))}`;
  const materials = materialStateSchema.parse(
    await send(`/authoring/import/materials/state${query}`),
  );
  const tasks = taskStateSchema.parse(
    await send(`/authoring/import/tasks/state${query}`),
  );
  if (materials.namespace !== namespace || tasks.namespace !== namespace)
    throw new Error("The receiver answered for another source namespace");
  return { materials: materials.materials, tasks: tasks.tasks };
}

/** @typedef {Awaited<ReturnType<typeof readNamespaceState>>} NamespaceState */

/**
 * The selected rows of the receiver state in the preserved shape, plus context links.
 *
 * @param {import("./target.mjs").LocalTransport} send
 * @param {string} namespace
 * @returns {ReadTargetState}
 */
export function apiPreservationState(send, namespace) {
  return async (materialIds, taskIds, contextMaterialIds = []) => {
    const state = await readNamespaceState(send, namespace);
    const codes = new Set(taskIds.map((id) => id.slice(id.indexOf(":") + 1)));
    return targetStateSchema.parse({
      materials: state.materials
        .filter((row) => materialIds.includes(row.sourceId))
        .map((row) => ({
          sourceId: row.sourceId,
          materialId: row.materialId,
          contentVersion: row.contentVersion,
          access: row.access,
          publicationState: row.publicationState,
          sourceRevision: row.source.revision,
          sourceCommit: row.source.commit,
          memberships: row.memberships
            .map(({ productId, ordinal, chapterId }) => ({
              productId,
              ordinal,
              chapterId,
            }))
            .sort((a, b) => a.productId.localeCompare(b.productId)),
        })),
      // A Task code in use by another source identity is returned too, so it is refused as ambiguous.
      tasks: state.tasks
        .filter((row) => taskIds.includes(row.sourceId) || codes.has(row.code))
        .map((row) => ({
          sourceId: row.sourceId,
          taskId: row.taskId,
          code: row.code,
          productId: row.productId,
          chapterId: row.chapterId,
          position: row.position,
          afterMaterialSourceId: row.afterMaterialSourceId,
          programmeVisibility: row.programmeVisibility,
          embeddedMaterialId: row.embeddedMaterialId,
          revision: row.revision,
          access: row.access,
          publicationState: row.publicationState,
          sourceCommit: row.sourceCommit,
        })),
      links: Object.fromEntries(
        state.materials.flatMap((row) =>
          contextMaterialIds.includes(row.sourceId) && row.slug !== null
            ? [[row.sourceId, `/materials/${row.slug}`]]
            : [],
        ),
      ),
    });
  };
}
