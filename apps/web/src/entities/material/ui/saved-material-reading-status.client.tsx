"use client";
import { useMaterialReading } from "../model/reading-context.client";
import { MaterialReadingStatus } from "./material-reading-status";
export function SavedMaterialReadingStatus({ materialId, format }: { readonly materialId: string; readonly format: string }) {
  const { state } = useMaterialReading(materialId);
  return <span className="inline-flex min-h-4"><MaterialReadingStatus format={format} isRead={state?.isRead === true} /></span>;
}
