import type { ReadingState } from "../domain/reading-state.js";

export function toReadingState(materialId: string, row: {
  isRead: boolean;
  readAt: Date | null;
  version: number;
  updatedAt: Date;
} | null): ReadingState {
  return {
    materialId,
    isRead: row?.isRead ?? false,
    readAt: row?.readAt?.toISOString() ?? null,
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}
