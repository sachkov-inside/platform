import { Activity } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useLiveSearchValue } from "@/shared/lib/use-live-search-value.client";

const host = document.getElementById("root");
if (!host) throw new Error("Missing fixture root");
const root = createRoot(host);

function Result({ query }: { query: string }) {
  return <output aria-label="Search query">{useLiveSearchValue(query)}</output>;
}

function show(query: string, mode: "visible" | "hidden") {
  flushSync(() => {
    root.render(
      <Activity mode={mode}>
        <Result query={query} />
      </Activity>,
    );
  });
}

const clock: Pick<Window, "setTimeout" | "clearTimeout"> = window;
const nativeTimeout = clock.setTimeout.bind(window);
const nativeClear = clock.clearTimeout.bind(window);
const pending = new Set<number>();
function isCallback(handler: TimerHandler): handler is () => void {
  return typeof handler === "function";
}
clock.setTimeout = (
  callback: TimerHandler,
  delay?: number,
  ...args: unknown[]
) => {
  if (delay !== 250 || !isCallback(callback) || args.length > 0)
    return nativeTimeout(callback, delay, ...args);
  const id = nativeTimeout(() => {
    pending.delete(id);
    callback();
  }, delay);
  pending.add(id);
  return id;
};
clock.clearTimeout = (id) => {
  if (id !== undefined) pending.delete(id);
  nativeClear(id);
};

Object.assign(window, {
  liveSearchFixture: {
    show,
    pending: () => pending.size,
    unmount: () => {
      root.unmount();
    },
  },
});
