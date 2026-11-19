import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

/** The story drives distinct React commits, including replacement and unmount. */
export function committedRoot(host: HTMLElement) {
  const root = createRoot(host);
  return {
    show(node: ReactNode) {
      flushSync(() => {
        root.render(node);
      });
    },
    unmount() {
      root.unmount();
    },
  };
}
