import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { materialId, type MaterialContent } from "../../../materials/index.js";
import type { MaterialReadingState } from "../../domain/reading-state.js";
import { toReadingState } from "../../shared/reading-state-mapping.js";

export const getReadingStatesSchema = z
  .object({ materialIds: z.array(z.uuid()).min(1).max(100) })
  .strict();
const querySchema = getReadingStatesSchema.extend({ accountId: z.uuid() });
export type GetReadingStatesResult =
  | { readonly ok: true; readonly value: readonly MaterialReadingState[] }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "dependency_unavailable" };
    };

export async function getReadingStates(
  dependencies: {
    readonly prisma: ReadingActivityPrismaClient;
    readonly materialContent: Pick<MaterialContent, "findUpdateNotes">;
  },
  input: {
    readonly accountId: string;
    readonly materialIds: readonly string[];
  },
): Promise<GetReadingStatesResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const accountId = parsed.data.accountId.toLowerCase();
  const ids = [
    ...new Set(parsed.data.materialIds.map((id) => id.toLowerCase())),
  ];
  try {
    const rows = await dependencies.prisma.readingMaterialState.findMany({
      where: { accountId, materialId: { in: ids } },
    });
    const states = new Map(rows.map((row) => [row.materialId, row]));
    const notes = await unseenUpdateNotes(
      dependencies,
      accountId,
      rows.flatMap((row) =>
        row.readAt === null
          ? []
          : [{ materialId: row.materialId, readAt: row.readAt }],
      ),
    );
    return {
      ok: true,
      value: ids.map((id) => ({
        ...toReadingState(id, states.get(id) ?? null),
        updateNote: notes.get(id) ?? null,
      })),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "reading-activity", operation: "getReadingStates" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}

/**
 * Notes of updates the Account has not seen: noted after its studied mark and after its last open.
 * The note is a secondary fact; when Materials cannot answer, the studied marks still return.
 */
async function unseenUpdateNotes(
  dependencies: {
    readonly prisma: ReadingActivityPrismaClient;
    readonly materialContent: Pick<MaterialContent, "findUpdateNotes">;
  },
  accountId: string,
  studied: readonly { readonly materialId: string; readonly readAt: Date }[],
): Promise<ReadonlyMap<string, MaterialReadingState["updateNote"]>> {
  if (studied.length === 0) return new Map();
  const notes = await dependencies.materialContent.findUpdateNotes(
    studied.map((item) => materialId(item.materialId)),
  );
  if (!notes.ok || notes.value.length === 0) return new Map();
  const visits = await dependencies.prisma.readingMaterialVisit.findMany({
    where: {
      accountId,
      materialId: { in: notes.value.map((note) => note.materialId) },
    },
    select: { materialId: true, lastOpenedAt: true },
  });
  const lastOpened = new Map(
    visits.map((visit) => [visit.materialId, visit.lastOpenedAt]),
  );
  const readAt = new Map(studied.map((item) => [item.materialId, item.readAt]));
  const unseen = new Map<string, MaterialReadingState["updateNote"]>();
  for (const note of notes.value) {
    const read = readAt.get(note.materialId);
    const opened = lastOpened.get(note.materialId);
    if (
      read !== undefined &&
      read < note.notedAt &&
      (opened === undefined || opened < note.notedAt)
    )
      unseen.set(note.materialId, {
        whatChanged: note.whatChanged,
        notedAt: note.notedAt.toISOString(),
      });
  }
  return unseen;
}
