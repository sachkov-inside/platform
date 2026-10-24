"use client";
import { captureAnalyticsOperation } from "./analytics.operation";
import { useEffect, useSyncExternalStore } from "react";
import {
  analyticsChoiceSchema,
  analyticsConfigSchema,
  analyticsConsentKey,
  analyticsSources,
  type AnalyticsEvent,
} from "../model/analytics-contract";

let revision: string | null = null;
let loading: Promise<void> | undefined;
let refusedInMemory = false;
const listeners = new Set<() => void>();
const pending = new Set<AbortController>();
const MAX_PENDING_ANALYTICS_REPORTS = 4;
const ANALYTICS_REPORT_TIMEOUT_MILLISECONDS = 2000;
function publish() {
  for (const listener of listeners) listener();
}
function onStorageChanged(event: StorageEvent) {
  if (event.key !== analyticsConsentKey && event.key !== null) return;
  for (const request of pending) request.abort();
  refusedInMemory = false;
  publish();
}
function subscribe(listener: () => void) {
  if (listeners.size === 0)
    window.addEventListener("storage", onStorageChanged);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0)
      window.removeEventListener("storage", onStorageChanged);
  };
}
function snapshot() {
  if (revision === null) return "";
  try {
    const stored = refusedInMemory
      ? JSON.stringify({ revision, choice: "necessary" })
      : (window.localStorage.getItem(analyticsConsentKey) ?? "");
    return `${revision}\n${stored}`;
  } catch {
    return revision;
  }
}
function parseChoice(raw: string, current: string) {
  try {
    const parsed = analyticsChoiceSchema.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.revision === current
      ? parsed.data.choice
      : "undecided";
  } catch {
    return "undecided";
  }
}
export function useAnalyticsChoice() {
  const current = useSyncExternalStore(subscribe, snapshot, () => "");
  useEffect(() => {
    loading ??= fetch("/api/analytics", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const parsed = analyticsConfigSchema.safeParse(await response.json());
        if (parsed.success && parsed.data.enabled)
          revision = parsed.data.revision;
        publish();
      })
      .catch(() => undefined);
  }, []);
  const [active = "", raw = ""] = current.split("\n");
  return {
    revision: active === "" ? null : active,
    choice: parseChoice(raw, active),
  };
}
/** Persist only the explicit choice, never a visitor or session identifier. Storage refusal fails closed. */
export function chooseAnalytics(
  current: string,
  choice: "necessary" | "allowed",
) {
  for (const request of pending) request.abort();
  refusedInMemory = true;
  try {
    window.localStorage.setItem(
      analyticsConsentKey,
      JSON.stringify({ revision: current, choice }),
    );
  } catch {
    try {
      window.localStorage.removeItem(analyticsConsentKey);
    } catch {
      /* The in-memory refusal still stops this document. */
    }
    publish();
    return false;
  }
  refusedInMemory = choice === "necessary";
  publish();
  return true;
}
export async function captureAnalytics(event: AnalyticsEvent) {
  if (
    revision === null ||
    refusedInMemory ||
    pending.size >= MAX_PENDING_ANALYTICS_REPORTS
  )
    return;
  const current = revision;
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(analyticsConsentKey);
  } catch {
    return;
  }
  if (parseChoice(stored ?? "", current) !== "allowed") return;
  const controller = new AbortController();
  pending.add(controller);
  try {
    await captureAnalyticsOperation.sendWithSignal(
      {
        revision: current,
        event,
        ...analyticsSources(window.location.href, document.referrer),
      },
      AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(ANALYTICS_REPORT_TIMEOUT_MILLISECONDS),
      ]),
    );
  } catch {
    /* Optional analytics has no retries, queue or product-facing failure. */
  } finally {
    pending.delete(controller);
  }
}
