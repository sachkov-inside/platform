"use client";
import { useMemo, useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  useMaterialReading,
  type LessonStepsProgress,
  type MaterialReadingSnapshot,
} from "@/entities/material";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";

import { recordOpenedPartsOperation } from "../api/reading-progress.operation";
import { LESSON_OPENED_PARTS_MAX } from "../model/opened-parts-contract";
import { lessonOpenedPartsChanges } from "../model/reading-progress-events";

/** A guest's opened parts stay in this browser only (#2122). */
export function guestOpenedPartsKey(materialId: string): string {
  return `inside.lesson-parts.v1:${materialId}`;
}

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
  };
}

function readGuestParts(materialId: string): number | null {
  try {
    const value = Number(
      window.localStorage.getItem(guestOpenedPartsKey(materialId)),
    );
    return Number.isInteger(value) &&
      value >= 1 &&
      value <= LESSON_OPENED_PARTS_MAX
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * Opened parts of a step-by-step lesson: a signed-in reader's come with the reading state and are
 * saved to the server; a guest's live in the browser. `saved` stays undefined until the owner of
 * the fact has answered, so the lesson does not jump to a part twice.
 */
export function useLessonOpenedParts(materialId: string): LessonStepsProgress {
  const reading = useMaterialReading(materialId);
  const queryClient = useQueryClient();
  const accountId = reading.resolved ? reading.accountId : undefined;
  // Browser storage exists only after hydration; the server render opens the first part.
  const guestSaved = useSyncExternalStore<number | null | undefined>(
    subscribeStorage,
    () => readGuestParts(materialId),
    () => undefined,
  );
  const stateKey = ["reading-progress", accountId, "material", materialId];
  const changes = useMemo(
    () => (accountId == null ? null : lessonOpenedPartsChanges(accountId)),
    [accountId],
  );
  useAnnouncedRefresh(changes, stateKey);
  const { mutate } = useMutation({
    mutationKey: ["reading-progress", accountId, "opened-parts", materialId],
    mutationFn: (openedParts: number) =>
      recordOpenedPartsOperation.send({ materialId, openedParts }),
    retry: 2,
    onSuccess: (result) => {
      if (result.kind !== "saved" || accountId == null) return;
      queryClient.setQueryData<
        MaterialReadingSnapshot & { materialId: string }
      >(stateKey, (state) =>
        state === undefined
          ? state
          : { ...state, openedParts: result.openedParts },
      );
      changes?.announce();
    },
  });
  if (accountId === undefined) return { saved: undefined, save: ignore };
  if (accountId === null)
    return {
      saved: guestSaved,
      save: (openedParts) => {
        try {
          window.localStorage.setItem(
            guestOpenedPartsKey(materialId),
            String(openedParts),
          );
        } catch {
          // Not a failure: without storage the parts stay open until the page closes.
        }
      },
    };
  return {
    // A failed read has not answered: the first part shows, and the next successful read of the
    // reading state still restores the saved parts.
    saved:
      reading.failed || reading.state === undefined
        ? undefined
        : (reading.state.openedParts ?? null),
    save: (openedParts) => {
      mutate(openedParts);
    },
  };
}

function ignore() {
  // The account is not known yet; the reader's next step saves the count again.
}
