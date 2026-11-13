import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import type { MaterialUpdateNoteInput } from "../../domain/material-update-note.js";

/**
 * Runs in the Save transaction, so the note and the content it describes commit together. The
 * package keeps a note between syncs: the stored `id` names the same update, whose text may be
 * corrected while its moment stays. A new `id` is a new update noted at this Save.
 */
export async function recordMaterialUpdateNote(
  transaction: MaterialsPrisma,
  materialId: string,
  note: MaterialUpdateNoteInput,
  savedAt: Date,
): Promise<void> {
  const current = await transaction.materialUpdateNote.findUnique({
    where: { materialId },
    select: { noteId: true },
  });
  const values = { noteId: note.id, whatChanged: note.whatChanged };
  if (current === null)
    await transaction.materialUpdateNote.create({
      data: { materialId, ...values, notedAt: savedAt },
    });
  else
    await transaction.materialUpdateNote.update({
      where: { materialId },
      data:
        current.noteId === note.id ? values : { ...values, notedAt: savedAt },
    });
}
