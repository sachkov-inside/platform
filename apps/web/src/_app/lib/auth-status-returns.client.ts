"use client";

import type { FactAnnouncement } from "@/shared/api/fact-announcement";

const listeners = new Set<(id: string) => void>();
function returned() {
  const id = crypto.randomUUID();
  for (const listener of listeners) listener(id);
}
function restored(event: PageTransitionEvent) {
  if (event.persisted) returned();
}

/** Focus and history-cache returns share one document listener and one identity per return. */
export const browserReturns: Pick<FactAnnouncement, "subscribe"> = {
  subscribe(listener) {
    const receive = (id: string) => {
      listener(id);
    };
    listeners.add(receive);
    if (listeners.size === 1) {
      window.addEventListener("focus", returned);
      window.addEventListener("pageshow", restored);
    }
    return () => {
      listeners.delete(receive);
      if (listeners.size === 0) {
        window.removeEventListener("focus", returned);
        window.removeEventListener("pageshow", restored);
      }
    };
  },
};
