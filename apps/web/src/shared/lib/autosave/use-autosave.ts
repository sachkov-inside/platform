"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const pendingSaves = new Set<() => Promise<boolean>>();
export async function flushPendingEdits(): Promise<boolean> {
  return (await Promise.all([...pendingSaves].map((flush) => flush()))).every(
    Boolean,
  );
}

export type AutosaveResult = "saved" | "invalid" | "failed";

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
  const latest = useRef({ value, key, save, enabled });
  useLayoutEffect(() => {
    latest.current = { value, key, save, enabled };
  });
  const baseline = useRef(key);
  const [savedKey, setSavedKey] = useState(key);
  const failed = useRef<{
    value: T;
    key: string;
    result: AutosaveResult;
  } | null>(null);
  const running = useRef<Promise<boolean> | null>(null);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const flush = useCallback(async function flush(
    retry = false,
  ): Promise<boolean> {
    while (running.current) {
      if (!(await running.current)) return false;
    }
    if (!latest.current.enabled) return false;
    if (
      failed.current &&
      !retry &&
      (failed.current.result === "failed" ||
        failed.current.key === latest.current.key)
    )
      return false;
    if (!failed.current && baseline.current === latest.current.key) return true;
    const snapshot =
      failed.current?.result === "failed" ? failed.current : latest.current;
    const execute = async () => {
      if (mounted.current) {
        setPending(true);
        setError(false);
      }
      let result: AutosaveResult;
      try {
        result = await latest.current.save(snapshot.value);
      } catch {
        result = "failed";
      }
      if (result === "saved") {
        baseline.current = snapshot.key;
        failed.current = null;
      } else
        failed.current = { value: snapshot.value, key: snapshot.key, result };
      if (mounted.current) {
        setSavedKey(baseline.current);
        setPending(false);
        setError(result !== "saved");
        setRevision((n) => n + 1);
      }
      return result === "saved";
    };
    running.current = execute();
    const saved = await running.current;
    running.current = null;
    // Flush includes edits made during the request, e.g. before opening preview.
    if (saved && latest.current.key !== baseline.current) return flush();
    return saved;
  }, []);

  useEffect(() => {
    if (!enabled || key === baseline.current || running.current) return;
    if (
      failed.current &&
      (failed.current.result === "failed" || failed.current.key === key)
    )
      return;
    const timer = window.setTimeout(() => {
      void flush();
    }, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [key, enabled, delay, flush, revision]);

  const dirty = key !== savedKey;
  useNavigationSave(flush, dirty || pending);
  return { dirty, pending, error, flush, retry: () => flush(true) };
}

export function usePendingUploadGuard(pending: boolean): void {
  const waitForUpload = useCallback(() => Promise.resolve(false), []);
  useNavigationSave(waitForUpload, pending);
}
function useNavigationSave(
  flush: () => Promise<boolean>,
  active: boolean,
): void {
  useEffect(() => {
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
    pendingSaves.add(flush);
    const navigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        (anchor.hash && anchor.pathname === window.location.pathname)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void flushPendingEdits().then((ok) => {
        if (ok) window.location.assign(anchor.href);
      });
    };
    document.addEventListener("click", navigate, true);
    return () => {
      pendingSaves.delete(flush);
      document.removeEventListener("click", navigate, true);
    };
  }, [active, flush]);
}
