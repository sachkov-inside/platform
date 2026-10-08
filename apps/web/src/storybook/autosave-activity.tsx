import { Activity, useState, type ReactNode } from "react";
import { expect, spyOn, userEvent, within } from "storybook/test";
import { flushPendingEdits } from "@/shared/lib/autosave/use-autosave";

/** The real page stays mounted while React cleans up its effects. */
export function AutosaveActivity({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button
        onClick={() => {
          setVisible((current) => !current);
        }}
      >
        {visible ? "Скрыть Activity" : "Вернуть Activity"}
      </button>
      <Activity mode={visible ? "visible" : "hidden"}>
        <div data-testid="autosave-activity">{children}</div>
      </Activity>
    </>
  );
}

export async function autosaveWhileHidden(
  canvasElement: HTMLElement,
  edit: () => Promise<void>,
  outcomeText: string | RegExp,
  response?: () => Response,
  editDuringSave?: () => Promise<void>,
  expectedRequests = editDuringSave ? 2 : 1,
) {
  const canvas = within(canvasElement);
  const originalFetch = window.fetch;
  const started = Promise.withResolvers<undefined>();
  const reply = Promise.withResolvers<undefined>();
  const timers = new Map<number, () => void>();
  const timerWindow: Pick<Window, "setTimeout" | "clearTimeout"> = window;
  const nativeTimeout = timerWindow.setTimeout;
  const nativeClearTimeout = timerWindow.clearTimeout;
  let timerId = -1;
  // Virtualize the public hook's default debounce; other browser timers keep their clock.
  const clock = spyOn(timerWindow, "setTimeout").mockImplementation(
    (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 700 && isTimerCallback(handler) && args.length === 0) {
        const id = timerId--;
        // TimerHandler's Function branch is callable; autosave's timer takes no arguments.
        const callback = () => {
          handler();
        };
        timers.set(id, callback);
        return id;
      }
      return nativeTimeout(handler, delay, ...args);
    },
  );
  const clearClock = spyOn(timerWindow, "clearTimeout").mockImplementation(
    (id) => {
      if (id !== undefined && timers.delete(id)) return;
      nativeClearTimeout(id);
    },
  );
  const advanceAutosaveClock = () => {
    const due = [...timers.values()];
    timers.clear();
    for (const callback of due) callback();
  };
  const request = spyOn(window, "fetch").mockImplementation(
    async (input, init) => {
      started.resolve(undefined);
      await reply.promise;
      return response ? response() : originalFetch(input, init);
    },
  );
  try {
    await edit();
    advanceAutosaveClock();
    await started.promise;
    if (editDuringSave) await editDuringSave();
    const completed = flushPendingEdits();
    await userEvent.click(
      canvas.getByRole("button", { name: "Скрыть Activity" }),
    );
    await expect(canvas.getByTestId("autosave-activity")).not.toBeVisible();
    reply.resolve(undefined);
    await completed;
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуть Activity" }),
    );
    advanceAutosaveClock();
    await flushPendingEdits();
    for (const outcome of await canvas.findAllByText(outcomeText)) {
      await expect(outcome).toBeVisible();
    }
    // The saved/retry outcome pins the returned state; cross its next debounce window too.
    advanceAutosaveClock();
    await flushPendingEdits();
    for (const outcome of canvas.getAllByText(outcomeText)) {
      await expect(outcome).toBeVisible();
    }
    await expect(request).toHaveBeenCalledTimes(expectedRequests);
  } finally {
    reply.resolve(undefined);
    request.mockRestore();
    clock.mockRestore();
    clearClock.mockRestore();
  }
}

function isTimerCallback(handler: TimerHandler): handler is () => void {
  return typeof handler === "function";
}
