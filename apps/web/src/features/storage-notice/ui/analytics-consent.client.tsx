"use client";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import { StorageNotice } from "./storage-notice.client";
import { chooseAnalytics, useAnalyticsChoice } from "../api/analytics.browser";
import { AnalyticsChoicePanel } from "./analytics-choice-panel.client";

const settingsEvent = "inside:analytics-settings";
export function AnalyticsSettingsLink() {
  const { revision } = useAnalyticsChoice();
  if (revision === null) return null;
  return (
    <button
      type="button"
      className="min-h-11 text-left underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      onClick={() => window.dispatchEvent(new Event(settingsEvent))}
    >
      Настройки cookies и аналитики
    </button>
  );
}
export function StorageAndAnalyticsNotice(props: {
  readonly edition: number;
  readonly policyHref: Route;
}) {
  const { revision, choice } = useAnalyticsChoice();
  const [editing, setEditing] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const open = () => {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setEditing(true);
      setError(false);
    };
    window.addEventListener(settingsEvent, open);
    return () => {
      window.removeEventListener(settingsEvent, open);
    };
  }, []);
  if (revision === null) return <StorageNotice {...props} />;
  if (choice !== "undecided" && !editing) return null;
  return (
    <AnalyticsChoicePanel
      policyHref={props.policyHref}
      error={error}
      focusOnOpen={editing}
      onChoose={(next) => {
        if (chooseAnalytics(revision, next)) {
          setEditing(false);
          setError(false);
          returnFocus.current?.focus();
        } else setError(true);
      }}
    />
  );
}
