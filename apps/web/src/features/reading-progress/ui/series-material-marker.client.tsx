"use client";

import { Check } from "lucide-react";

import { useMaterialReading } from "@/entities/material";
import { cn } from "@/shared/lib/utils";

/** Fixed-size route marker: keeps its ordinal alongside the saved Material mark. */
export function SeriesMaterialMarker({ materialId, ordinal }: { readonly materialId?: string; readonly ordinal: number }) {
  const { state } = useMaterialReading(materialId);
  const isRead = state?.isRead === true;
  return (
    <span
      aria-label={`Материал ${String(ordinal)}${isRead ? ", изучен" : ""}`}
      className={cn("grid relative size-8 place-items-center rounded-full text-xs font-bold ring-4 ring-background", isRead ? "bg-accent text-accent-foreground" : "bg-primary text-white")}
      data-series-marker
      data-series-marker-read={isRead}
      role="img"
    >
      <span aria-hidden="true">{ordinal}</span>
      {isRead ? <Check aria-hidden="true" className="absolute -bottom-1 -right-1 size-4 rounded-full bg-accent text-accent-foreground ring-2 ring-background" strokeWidth={3} /> : null}
    </span>
  );
}
