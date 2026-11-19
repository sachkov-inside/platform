import { Activity } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { expect, spyOn } from "storybook/test";
import { useLiveSearchValue } from "./use-live-search-value.client";

const meta = { title: "Patterns/Search/Delayed value" };
export default meta;

function isCallback(handler: TimerHandler): handler is () => void {
  return typeof handler === "function";
}

function Result({ text }: { text: string }) {
  return <output>{useLiveSearchValue(text)}</output>;
}

export const ReplacementAndRelease = {
  render: () => <div />,
  play: async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const clock: Pick<Window, "setTimeout" | "clearTimeout"> = window;
    const nativeTimeout = clock.setTimeout.bind(window);
    const nativeClear = clock.clearTimeout.bind(window);
    const pending = new Map<number, { at: number; run: () => void }>();
    let now = 0;
    let nextId = -1;
    const timeout = spyOn(clock, "setTimeout").mockImplementation(
      (callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay !== 250 || !isCallback(callback) || args.length > 0)
          return nativeTimeout(callback, delay, ...args);
        const id = nextId--;
        pending.set(id, {
          at: now + delay,
          run: callback,
        });
        return id;
      },
    );
    const clear = spyOn(clock, "clearTimeout").mockImplementation((id) => {
      if (id === undefined || !pending.delete(id)) nativeClear(id);
    });
    function advance(ms: number) {
      now += ms;
      flushSync(() => {
        for (const [id, timer] of pending) {
          if (timer.at > now) continue;
          pending.delete(id);
          timer.run();
        }
      });
    }
    function render(text: string, mode: "visible" | "hidden" = "visible") {
      flushSync(() => {
        root.render(
          <Activity mode={mode}>
            <Result text={text} />
          </Activity>,
        );
      });
    }
    try {
      render("initial");
      await expect(host.textContent).toBe("initial");
      render("first");
      advance(249);
      await expect(host.textContent).toBe("initial");
      render("second");
      advance(249);
      await expect(host.textContent).toBe("initial");
      advance(1);
      await expect(host.textContent).toBe("second");
      render("hidden update");
      render("hidden update", "hidden");
      await expect(pending.size).toBe(0);
      advance(250);
      render("hidden update");
      await expect(host.textContent).toBe("second");
      advance(250);
      await expect(host.textContent).toBe("hidden update");
      render("final update");
      await expect(pending.size).toBe(1);
      flushSync(() => {
        root.render(null);
      });
      await expect(pending.size).toBe(0);
    } finally {
      try {
        root.unmount();
      } finally {
        clear.mockRestore();
        timeout.mockRestore();
      }
    }
  },
};
