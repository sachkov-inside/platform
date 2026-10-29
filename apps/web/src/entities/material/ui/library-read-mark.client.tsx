"use client";

import { Check } from "lucide-react";

import { useMaterialReading } from "../model/reading-context.client";
import { materialReadingLabels } from "./material-reading-status";

/** Personal «изучено» mark in the corner of a library cover; nothing while the Material is unread. */
export function LibraryReadMark({
  format,
  materialId,
}: {
  readonly format: string;
  readonly materialId: string;
}) {
  const { state } = useMaterialReading(materialId);
  if (state?.isRead !== true) return null;
  return (
    <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-white/90 text-foreground shadow-sm">
      <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
      <span className="sr-only">{materialReadingLabels(format).complete}</span>
    </span>
  );
}
