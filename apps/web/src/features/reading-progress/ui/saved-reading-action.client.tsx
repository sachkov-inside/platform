"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import { setReadingState } from "../api/reading.browser";
import { useReadingCommandHistory } from "../model/use-reading-command-history.client";
import {
  readingProgressChanges,
  refreshReadingProgress,
} from "../model/reading-progress-events";
import type { ReadingActionView } from "../model/reading-progress-view";
import { ReadingAction } from "./reading-action.client";

export function SavedReadingAction({
  materialId,
  format,
  canMark = true,
  compact = false,
}: {
  readonly materialId: string;
  readonly format: string;
  readonly canMark?: boolean;
  readonly compact?: boolean;
}) {
  const reading = useMaterialReading(materialId);
  const queryClient = useQueryClient();
  const { mutationKey, saving, latest, clearFinished } =
    useReadingCommandHistory(
      queryClient,
      reading.accountId,
      materialId,
      canMark && reading.resolved,
    );
  const denied = latest?.result?.kind === "denied";
  const notice =
    latest?.status === "error" ||
    (latest?.status === "success" &&
      latest.result?.kind !== "saved" &&
      latest.result?.kind !== "conflict" &&
      latest.result?.kind !== "denied")
      ? "error"
      : latest?.result?.kind === "conflict"
        ? "conflict"
        : null;
  const mutation = useMutation({
    mutationKey,
    mutationFn: setReadingState,
    onSuccess: async (result) => {
      if (result.kind === "unavailable") return;
      if (result.kind === "saved" && reading.accountId !== null) {
        const id = readingProgressChanges(reading.accountId).announce();
        await refreshReadingProgress(queryClient, reading.accountId, id);
      } else await reading.refresh();
    },
  });
  const state = reading.state;
  const isRead = state?.isRead === true;
  let view: ReadingActionView;
  if (!reading.resolved) view = { kind: "loading" };
  else if (reading.accountId === null)
    view = { kind: "anonymous", loginHref: "/account" };
  else if (state === undefined) {
    view = { kind: reading.failed ? "load-error" : "loading" };
  } else if (saving)
    view = {
      kind: "pending",
      isRead,
      canMark: canMark && !denied,
      desiredIsRead: latest?.command?.isRead ?? !isRead,
    };
  else if (notice === "error")
    view = {
      kind: "error",
      isRead,
      canMark: canMark && !denied,
      desiredIsRead: latest?.command?.isRead ?? !isRead,
    };
  else
    view = {
      kind: notice === "conflict" ? "conflict" : "ready",
      isRead,
      canMark: canMark && !denied,
    };
  return (
    <ReadingAction
      compact={compact}
      format={format}
      view={view}
      onRefresh={() => {
        void reading.refresh().then(clearFinished);
      }}
      onSetReadingState={(desired) => {
        if (state === undefined || saving) return;
        const command = (notice === "error" ? latest?.command : undefined) ?? {
          materialId,
          isRead: desired,
          expectedVersion: state.version,
          commandId: crypto.randomUUID(),
        };
        mutation.mutate(command);
      }}
    />
  );
}
