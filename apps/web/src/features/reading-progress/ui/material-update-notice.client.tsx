"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";

import {
  useMaterialReading,
  type MaterialUpdateNote,
} from "@/entities/material";

/**
 * The banner at the start of a lesson the reader studied before a substantial update (#2125).
 * Opening the lesson clears the note on the server, and the reading state is then read again
 * without it; the banner keeps the note it first saw for as long as this page stays open.
 */
export function MaterialUpdateNotice({
  materialId,
}: {
  readonly materialId: string;
}) {
  const { state } = useMaterialReading(materialId);
  const [seen, setSeen] = useState<MaterialUpdateNote | null>(null);
  const current = state?.updateNote ?? null;
  if (current !== null && current.notedAt !== seen?.notedAt) setSeen(current);
  const note = current ?? seen;
  if (note === null) return null;
  return (
    <aside
      className="mt-6 flex gap-3 rounded-xl border border-accent/30 bg-accent/8 px-4 py-3 text-sm leading-6 text-foreground"
      data-material-update-notice
    >
      <RefreshCw
        aria-hidden="true"
        className="mt-1 size-4 shrink-0 text-accent"
      />
      <p>
        <strong className="font-semibold">
          Урок обновлён после того, как ты его изучил:
        </strong>{" "}
        {note.whatChanged}
      </p>
    </aside>
  );
}
