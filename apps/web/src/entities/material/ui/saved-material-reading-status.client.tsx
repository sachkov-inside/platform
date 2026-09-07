"use client";
import { useMaterialReading } from "../model/reading-context.client";
import { MaterialReadingStatus } from "./material-reading-status";
export function SavedMaterialReadingStatus({ materialId, format }: { readonly materialId: string; readonly format: string }) {
  const { state } = useMaterialReading(materialId);
  return <MaterialReadingStatus format={format} isRead={state?.isRead === true} />;
}
