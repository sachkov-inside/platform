"use client";

import { Check } from "lucide-react";

import { useMaterialReading } from "@/entities/material";
import { cn } from "@/shared/lib/utils";

/** Fixed-size route marker: a saved Material mark replaces its visible ordinal. */
export function SeriesMaterialMarker({ materialId, ordinal }: { readonly materialId?: string; readonly ordinal: number }) {
  const { state } = useMaterialReading(materialId);
  const isRead = state?.isRead === true;
  return (
    <span
      aria-label={`Материал ${String(ordinal)}${isRead ? ", изучен" : ""}`}
      className={cn("grid size-8 place-items-center rounded-full text-xs font-bold ring-4 ring-background", isRead ? "bg-accent text-accent-foreground" : "bg-primary text-white")}
      data-series-marker
      data-series-marker-read={isRead}
      role="img"
    >
      {isRead ? <Check aria-hidden="true" className="size-5" strokeWidth={3} /> : <span aria-hidden="true">{ordinal}</span>}
    </span>
  );
}
