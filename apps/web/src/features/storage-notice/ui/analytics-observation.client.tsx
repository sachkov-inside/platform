"use client";
import { useEffect, useRef } from "react";
import { captureAnalytics, useAnalyticsChoice } from "../api/analytics.browser";
import type { AnalyticsEvent } from "../model/analytics-contract";
/** Observe a visible rendered state. Server renders and route prefetch never send events. */
export function AnalyticsObservation({
  event,
  entityId,
}: {
  readonly event: AnalyticsEvent;
  readonly entityId: string;
}) {
  const marker = useRef<HTMLSpanElement>(null);
  const { revision, choice } = useAnalyticsChoice();
  useEffect(() => {
    const element = marker.current;
    if (element === null || revision === null || choice !== "allowed") return;
    let visible = false;
    let sent = false;
    const capture = () => {
      if (
        visible &&
        !sent &&
        document.visibilityState === "visible" &&
        element.closest("[inert]") === null
      ) {
        sent = true;
        void captureAnalytics(event, entityId);
      }
    };
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      capture();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", capture);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", capture);
    };
  }, [event, entityId, revision, choice]);
  return (
    <span
      ref={marker}
      aria-hidden="true"
      className="pointer-events-none absolute size-px"
    />
  );
}
