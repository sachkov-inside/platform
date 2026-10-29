"use client";

import { Check } from "lucide-react";

import { useMaterialReading } from "@/entities/material";

/**
 * Reading status of a programme lesson row: a thin accent check once the Material is saved as
 * studied, nothing before that. The check stays light so it does not compete with the title.
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
  return (
    <span
      aria-label={`Материал ${String(ordinal)}, изучен`}
      className="grid size-5 place-items-center text-accent"
      data-product-marker
      data-product-marker-read
      role="img"
    >
      <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
    </span>
  );
}
