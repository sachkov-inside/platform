"use client";
import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useMaterialReading } from "@/entities/material";

import { resetReadingProgressOperation } from "../api/reading-progress.operation";
import {
  lessonOpenedPartsChanges,
  readingProgressChanges,
  refreshReadingProgress,
} from "../model/reading-progress-events";

export type ProgressResetStatus = "idle" | "pending" | "failed" | "done";

/**
 * Starts the given Materials over for the signed-in reader: their studied marks and opened lesson
 * parts. A retry after a failure repeats the same command, so a reset the server already applied
 * is not applied twice. After a reset every surface of this account re-reads its progress, here
 * and in other tabs.
 */
export function useProgressReset(materialIds: readonly string[]): {
  readonly status: ProgressResetStatus;
  readonly reset: () => void;
} {
  const { accountId } = useMaterialReading();
  const queryClient = useQueryClient();
  const commandId = useRef<string | null>(null);
  const mutation = useMutation({
    mutationFn: resetReadingProgressOperation.send,
    onSuccess: async (result) => {
      if (result.kind !== "reset" || accountId === null) return;
      commandId.current = null;
      lessonOpenedPartsChanges(accountId).announce();
      const id = readingProgressChanges(accountId).announce();
      await refreshReadingProgress(queryClient, accountId, id);
    },
  });
  const status: ProgressResetStatus = mutation.isPending
    ? "pending"
    : mutation.isError || (mutation.isSuccess && mutation.data.kind !== "reset")
      ? "failed"
      : mutation.isSuccess
        ? "done"
        : "idle";
  return {
    status,
    reset: () => {
      if (mutation.isPending || materialIds.length === 0) return;
      commandId.current ??= crypto.randomUUID();
      mutation.mutate({
        materialIds: [...new Set(materialIds)],
        commandId: commandId.current,
      });
    },
  };
}
