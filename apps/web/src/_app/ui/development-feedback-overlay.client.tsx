"use client";

import { Agentation } from "agentation";
import { useSyncExternalStore } from "react";

const agentationEndpoint = "http://127.0.0.1:4747";
const subscribeToFeedbackAvailability = () => () => undefined;
const readFeedbackAvailability = () => !navigator.webdriver;
const readServerFeedbackAvailability = () => false;

export function DevelopmentFeedbackOverlay() {
  const isEnabled = useSyncExternalStore(
    subscribeToFeedbackAvailability,
    readFeedbackAvailability,
    readServerFeedbackAvailability,
  );

  if (!isEnabled) {
    return null;
  }

  return (
    <div data-agentation-root>
      <Agentation
        className="platform-agentation"
        endpoint={agentationEndpoint}
      />
    </div>
  );
}
