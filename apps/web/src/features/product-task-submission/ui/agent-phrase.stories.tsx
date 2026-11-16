import { act } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, waitFor, within } from "storybook/test";

import { MaterialBodyView } from "@/entities/material";

import { AgentPhrase } from "./agent-phrase.client";

const meta = {
  component: AgentPhrase,
  title: "Components/Tasks/Agent phrase",
  args: { text: "Помоги разобраться с заданием и проверить результат." },
} satisfies Meta<typeof AgentPhrase>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ClipboardUnavailable: Story = {
  beforeEach: () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    return () => {
      if (previous === undefined)
        Reflect.deleteProperty(navigator, "clipboard");
      else Object.defineProperty(navigator, "clipboard", previous);
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Скопировать запрос" }),
    );
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Не удалось скопировать",
      ),
    );
  },
};

export const ClipboardUnavailableMobile: Story = {
  ...ClipboardUnavailable,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};

export const CopyFeedback: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const clock = feedbackClock();
    const second = Promise.withResolvers<undefined>();
    const copy = spyOn(navigator.clipboard, "writeText")
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => second.promise);
    try {
      await userEvent.click(
        canvas.getByRole("button", { name: "Скопировать запрос" }),
      );
      await waitFor(async () => {
        await expect(canvas.getByRole("status")).toHaveTextContent(
          "Скопировано",
        );
        await expect(clock.pending()).toBe(1);
      });
      await expect(copy).toHaveBeenNthCalledWith(1, args.text);
      act(() => {
        clock.advance(1_999);
      });
      await expect(canvas.getByRole("status")).toHaveTextContent("Скопировано");
      act(() => {
        clock.advance(1);
      });
      await expect(canvas.getByRole("status")).toHaveTextContent(
        "Скопировать запрос",
      );
      await userEvent.click(
        canvas.getByRole("button", { name: "Скопировать запрос" }),
      );
      await expect(copy).toHaveBeenNthCalledWith(2, args.text);
      await act(async () => {
        second.resolve(undefined);
        await second.promise;
      });
      await waitFor(async () => {
        await expect(canvas.getByRole("status")).toHaveTextContent(
          "Скопировано",
        );
        await expect(clock.pending()).toBe(1);
      });
      act(() => {
        clock.advance(2_000);
      });
      await expect(canvas.getByRole("status")).toHaveTextContent(
        "Скопировать запрос",
      );
    } finally {
      second.resolve(undefined);
      copy.mockRestore();
      clock.cleanup();
    }
  },
};

export const LatestCopyWins: Story = {
  render: ({ text }) => (
    <MaterialBodyView
      blocks={[{ kind: "code_block", text }]}
      path={[]}
      rendering={{
        headingId: (path) => `material-section-${path.join("-")}`,
        image: () => null,
        file: () => null,
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = Promise.withResolvers<undefined>();
    const copy = spyOn(navigator.clipboard, "writeText")
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    try {
      const button = canvas.getByRole("button", { name: "Скопировать код" });
      await userEvent.click(button);
      await userEvent.click(button);
      await waitFor(() =>
        expect(canvas.getByRole("status")).toHaveTextContent("Код скопирован"),
      );
      window.getSelection()?.removeAllRanges();
      await act(async () => {
        first.reject(new Error("denied"));
        await first.promise.catch(() => undefined);
      });
      await expect(canvas.getByRole("status")).toHaveTextContent(
        "Код скопирован",
      );
      await expect(window.getSelection()?.toString()).toBe("");
    } finally {
      first.resolve(undefined);
      copy.mockRestore();
      window.getSelection()?.removeAllRanges();
    }
  },
};

/** Virtualizes the two-second clipboard feedback, leaving render and assertion clocks native. */
function feedbackClock() {
  const timers = new Map<number, { at: number; callback: () => void }>();
  let now = 0;
  let nextId = -1;
  const timerWindow: Pick<Window, "setTimeout" | "clearTimeout"> = window;
  const nativeTimeout = timerWindow.setTimeout;
  const nativeClear = timerWindow.clearTimeout;
  const timeout = spyOn(timerWindow, "setTimeout").mockImplementation(
    (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay !== 2_000 || !isTimerCallback(handler) || args.length !== 0)
        return nativeTimeout(handler, delay, ...args);
      const id = nextId--;
      timers.set(id, { at: now + delay, callback: handler });
      return id;
    },
  );
  const clear = spyOn(timerWindow, "clearTimeout").mockImplementation((id) => {
    if (id !== undefined && timers.delete(id)) return;
    nativeClear(id);
  });
  return {
    pending: () => timers.size,
    advance: (ms: number) => {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    cleanup: () => {
      timers.clear();
      timeout.mockRestore();
      clear.mockRestore();
    },
  };
}

function isTimerCallback(handler: TimerHandler): handler is () => void {
  return typeof handler === "function";
}
