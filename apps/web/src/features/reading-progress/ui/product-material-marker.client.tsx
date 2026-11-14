"use client";

import { Check } from "lucide-react";

import { useMaterialReading } from "@/entities/material";

/**
 * Reading status of a programme lesson row: a thin accent check once the Material is saved as
 * studied, nothing before that. The check stays light so it does not compete with the title.
 * A substantial update the reader has not seen since studying the lesson adds the word «обновлён»
 * before the check; the studied mark stays (#2125).
 */
export function ProductMaterialMarker({
  materialId,
  ordinal,
}: {
  readonly materialId?: string;
  readonly ordinal: number;
}) {
  const { state } = useMaterialReading(materialId);
  if (state?.isRead !== true) return null;
  const updated = state.updateNote != null;
  return (
    <span className="inline-flex items-center gap-2">
      {updated ? (
        <span
          aria-hidden="true"
          className="inline-flex shrink-0 items-center rounded-full bg-accent/12 px-2 py-0.5 text-[0.6875rem] font-semibold leading-4 text-[color-mix(in_srgb,var(--action)_85%,var(--foreground))]"
          data-product-marker-updated
        >
          обновлён
        </span>
      ) : null}
      <span
        aria-label={`Материал ${String(ordinal)}, изучен${updated ? ", обновлён после изучения" : ""}`}
        className="grid size-5 place-items-center text-accent"
        data-product-marker
        data-product-marker-read
        role="img"
      >
        <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
      </span>
    </span>
  );
}
