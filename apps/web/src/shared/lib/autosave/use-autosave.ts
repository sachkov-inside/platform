"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import {
  createAutosaveModel,
  type AutosaveResult,
  type AutosaveStatus,
} from "./autosave-model";
import { registerPendingEdit } from "./pending-navigation";
export { flushPendingEdits } from "./pending-navigation";
export type { AutosaveResult } from "./autosave-model";

/** One request at a time; retries replay the same snapshot before newer edits. */
export function useAutosave<T>({
  value,
  save,
  enabled = true,
  delay = 700,
}: {
  readonly value: T;
  readonly save: (snapshot: T) => Promise<AutosaveResult>;
  readonly enabled?: boolean;
  readonly delay?: number;
}) {
  const key = JSON.stringify(value);
  const [status, setStatus] = useState<AutosaveStatus>(() => ({
    savedKey: key,
    pending: false,
    rejection: null,
  }));
  const [model] = useState(() =>
    createAutosaveModel({ value, key, save, enabled }, setStatus),
  );
  useLayoutEffect(() => {
    model.commit({ value, key, save, enabled });
  });
  const dirty = key !== status.savedKey;
  const shouldSchedule =
    enabled &&
    dirty &&
    !status.pending &&
    status.rejection?.result !== "failed" &&
    status.rejection?.key !== key;
  useEffect(() => {
    if (!shouldSchedule) return;
    const timer = window.setTimeout(() => {
      void model.flush();
    }, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [key, delay, shouldSchedule, model]);
  useNavigationSave(model.flush, dirty || status.pending);
  return {
    dirty,
    pending: status.pending,
    error: status.rejection !== null && !status.pending,
    flush: model.flush,
    retry: () => model.flush(true),
  };
}

export function usePendingUploadGuard(pending: boolean): void {
  const waitForUpload = useCallback(() => Promise.resolve(false), []);
  useNavigationSave(waitForUpload, pending);
}
function useNavigationSave(
  flush: () => Promise<boolean>,
  active: boolean,
): void {
  // Release before the saved status becomes visible.
  // See [BeforeUnloadFollowsActivity](../../../_pages/content-collections/ui/product-editor-page.stories.tsx).
  useLayoutEffect(() => {
    if (!active) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      window.removeEventListener("beforeunload", guard);
    };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    return registerPendingEdit(flush);
  }, [active, flush]);
}
