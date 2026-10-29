"use client";

import { Check } from "lucide-react";

import { useMaterialReading } from "@/entities/material";
import { cn } from "@/shared/lib/utils";

/** Fixed-size route marker: a saved Material mark replaces its visible ordinal. */
export function ProductMaterialMarker({
  materialId,
  ordinal,
  statusOnly = false,
}: {
  readonly materialId?: string;
  readonly ordinal: number;
  readonly statusOnly?: boolean;
}) {
  const { state } = useMaterialReading(materialId);
  const isRead = state?.isRead === true;
  if (statusOnly && !isRead) return null;
  return (
    <span
      aria-label={`Материал ${String(ordinal)}${isRead ? ", изучен" : ""}`}
      className={cn(
        "grid place-items-center rounded-full text-xs font-bold",
        // В строке программы отметка тонкая галочка без круга: она не спорит с названием урока.
        statusOnly
          ? "size-5 text-accent"
          : cn(
              "size-6 ring-4 ring-background sm:size-8",
              isRead
                ? "bg-accent text-accent-foreground"
                : "bg-primary text-white",
            ),
      )}
      data-product-marker
      data-product-marker-read={isRead}
      role="img"
    >
      {isRead ? (
        <Check
          aria-hidden="true"
          className={statusOnly ? "size-4" : "size-4 sm:size-5"}
          strokeWidth={statusOnly ? 2.5 : 3}
        />
      ) : (
        <span aria-hidden="true">{ordinal}</span>
      )}
    </span>
  );
}
