"use client";

import { Agentation } from "agentation";
import { useEffect, useState } from "react";

const agentationEndpoint = "http://127.0.0.1:4747";

export function DevelopmentFeedbackOverlay() {
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    setIsEnabled(!navigator.webdriver);
  }, []);

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
