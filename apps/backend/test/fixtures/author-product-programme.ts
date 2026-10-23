import { randomUUID } from "node:crypto";
import type { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import type { ReorderSeriesCommand } from "../../src/modules/products/features/reorder-series/reorder-series.contract.js";

type Authoring = ReturnType<typeof assembleMaterials>["authoring"];

/** Fixture intent: replace the primary programme explicitly, retaining existing occurrence IDs. */
export async function authorProductProgramme(
  authoring: Authoring,
  command: ReorderSeriesCommand,
) {
  const loaded = await authoring.loadSeriesOrder({
    actor: command.actor,
    seriesId: command.seriesId,
  });
  if (!loaded.ok) throw new Error(loaded.error.code);
  const current = loaded.value;
  const chapterIds = (command.chapters ?? current.chapters).map(({ id }) => id);
  const programmePlacements = command.orderedMaterialIds.flatMap(
    (materialId) => {
      const previous = current.programmePlacements.find(
        (entry) => entry.materialId === materialId,
      );
      const chapterId =
        chapterIds.length === 0
          ? null
          : command.chapterAssignments === undefined
            ? (previous?.chapterId ?? null)
            : (command.chapterAssignments[materialId] ?? null);
      if (chapterIds.length > 0 && chapterId === null) return [];
      return [
        {
          id: previous?.id ?? randomUUID(),
          materialId,
          chapterId,
          stepGroup:
            command.stepGroups === undefined
              ? (previous?.stepGroup ?? null)
              : (command.stepGroups[materialId] ?? null),
        },
      ];
    },
  );
  return authoring.reorderSeries({
    ...command,
    programmePlacements: command.programmePlacements ?? programmePlacements,
  });
}
