import { act, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, spyOn, userEvent, waitFor, within } from "storybook/test";
import { AutosaveActivity } from "@/storybook/autosave-activity";
import { authoringPageEnvironment } from "@/storybook/story-environment";
import { MaterialVideoAuthoring } from "./material-video-authoring.client";

const deletingVideo = {
  origin: "platform_upload",
  state: "deleting",
  title: "Удаляемый урок",
  videoId: "03000000-0000-4000-8000-000000000001",
} as const;
const materialId = "02000000-0000-4000-8000-000000000010";

/** Virtualizes only the five-second provider polling clock, not render or assertion barriers. */
function pollingHarness() {
  const timers = new Map<number, { callback: () => void; repeat: boolean }>();
  let nextId = -1;
  const timerWindow: Pick<
    Window,
    "setTimeout" | "setInterval" | "clearTimeout" | "clearInterval"
  > = window;
  const nativeTimeout = timerWindow.setTimeout;
  const nativeInterval = timerWindow.setInterval;
  const nativeClearTimeout = timerWindow.clearTimeout;
  const nativeClearInterval = timerWindow.clearInterval;
  const schedule =
    (repeat: boolean, native: typeof timerWindow.setTimeout) =>
    (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay !== 5_000 || !isTimerCallback(handler) || args.length !== 0)
        return native(handler, delay, ...args);
      const id = nextId--;
      timers.set(id, {
        callback: () => {
          handler();
        },
        repeat,
      });
      return id;
    };
  const timeout = spyOn(timerWindow, "setTimeout").mockImplementation(
    schedule(false, nativeTimeout),
  );
  const interval = spyOn(timerWindow, "setInterval").mockImplementation(
    schedule(true, nativeInterval),
  );
  const clearTimeout = spyOn(timerWindow, "clearTimeout").mockImplementation(
    (id) => {
      if (id !== undefined && timers.delete(id)) return;
      nativeClearTimeout(id);
    },
  );
  const clearInterval = spyOn(timerWindow, "clearInterval").mockImplementation(
    (id) => {
      if (id !== undefined && timers.delete(id)) return;
      nativeClearInterval(id);
    },
  );
  const responses: ReturnType<typeof Promise.withResolvers<Response>>[] = [];
  const request = spyOn(window, "fetch").mockImplementation(() => {
    const response = Promise.withResolvers<Response>();
    responses.push(response);
    return response.promise;
  });
  return {
    request,
    timers,
    advance: () => {
      for (const [id, timer] of [...timers]) {
        if (!timer.repeat) timers.delete(id);
        timer.callback();
      }
    },
    respond: (index: number, state: "deleting" | "deleted") => {
      responses[index]?.resolve(
        Response.json({
          kind: "ready",
          value: {
            ...deletingVideo,
            access: "closed",
            materialId,
            state,
          },
        }),
      );
    },
    cleanup: () => {
      for (const response of responses)
        response.resolve(new Response(null, { status: 503 }));
      request.mockRestore();
      timeout.mockRestore();
      interval.mockRestore();
      clearTimeout.mockRestore();
      clearInterval.mockRestore();
    },
  };
}
let polling: ReturnType<typeof pollingHarness> | undefined;
const environment = authoringPageEnvironment(
  `/authoring/materials/${materialId}`,
);
const meta = {
  ...environment,
  title: "Components/Material video/Polling",
  component: MaterialVideoAuthoring,
  beforeEach: () => {
    environment.beforeEach();
    polling = pollingHarness();
    return () => {
      polling?.cleanup();
      polling = undefined;
    };
  },
  args: {
    access: "closed",
    deleteVideoId: null,
    disabled: false,
    latestVideoDeletion: deletingVideo,
    materialId,
    onChange: fn(),
    primaryVideo: null,
    unselectedUpload: null,
  },
} satisfies Meta<typeof MaterialVideoAuthoring>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SlowDeletion: Story = {
  play: async ({ canvasElement }) => {
    if (polling === undefined) throw new Error("Polling clock is required");
    const clock = polling;
    const canvas = within(canvasElement);
    await waitFor(() => expect(clock.timers.size).toBe(1));
    await act(async () => {
      clock.advance();
      await Promise.resolve();
    });
    await waitFor(() => expect(clock.request).toHaveBeenCalledTimes(1));
    // Cross two polling intervals while the first provider request is deliberately held.
    await act(async () => {
      clock.advance();
      await Promise.resolve();
    });
    await act(async () => {
      clock.advance();
      await Promise.resolve();
    });
    await expect(clock.request).toHaveBeenCalledTimes(1);
    clock.respond(0, "deleting");
    await waitFor(() => expect(clock.timers.size).toBe(1));
    await act(async () => {
      clock.advance();
      await Promise.resolve();
    });
    await waitFor(() => expect(clock.request).toHaveBeenCalledTimes(2));
    clock.respond(1, "deleted");
    await expect(
      await canvas.findByText(/удалено из Kinescope/u),
    ).toBeVisible();
    await act(async () => {
      clock.advance();
      await Promise.resolve();
    });
    await expect(clock.request).toHaveBeenCalledTimes(2);
  },
};

export const ReturnAfterDisconnect: Story = {
  render: (args) => (
    <AutosaveActivity>
      <MaterialVideoAuthoring {...args} />
    </AutosaveActivity>
  ),
  play: async ({ canvasElement }) => {
    if (polling === undefined) throw new Error("Polling clock is required");
    const clock = polling;
    const canvas = within(canvasElement);
    await waitFor(() => expect(clock.timers.size).toBe(1));
    await act(async () => {
      clock.advance();
      await Promise.resolve();
    });
    await waitFor(() => expect(clock.request).toHaveBeenCalledTimes(1));
    await userEvent.click(
      canvas.getByRole("button", { name: "Скрыть Activity" }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Вернуть Activity" }),
    );
    await expect(canvas.queryByText(/удалено из Kinescope/u)).toBeNull();
    await waitFor(() => expect(clock.timers.size).toBe(1));
    await act(async () => {
      clock.advance();
      await Promise.resolve();
    });
    await expect(clock.request).toHaveBeenCalledTimes(1);
    await act(async () => {
      clock.respond(0, "deleted");
      await Promise.resolve();
    });
    // The pre-disconnect response is discarded; continuation makes a fresh sequential read.
    await waitFor(() => expect(clock.request).toHaveBeenCalledTimes(2));
    clock.respond(1, "deleted");
    await expect(
      await canvas.findByText(/удалено из Kinescope/u),
    ).toBeVisible();
  },
};

function ReplaceDeletionTarget(
  args: Parameters<typeof MaterialVideoAuthoring>[0],
) {
  const [target, setTarget] = useState(args.latestVideoDeletion);
  return (
    <>
      <button
        onClick={() => {
          setTarget({
            ...deletingVideo,
            title: "Другой урок",
            videoId: "03000000-0000-4000-8000-000000000002",
          });
        }}
      >
        Другой объект удаления
      </button>
      <MaterialVideoAuthoring {...args} latestVideoDeletion={target} />
    </>
  );
}
export const ReplacedDeletionTarget: Story = {
  render: (args) => <ReplaceDeletionTarget {...args} />,
  play: async ({ canvasElement }) => {
    if (polling === undefined) throw new Error("Polling clock is required");
    const clock = polling;
    const canvas = within(canvasElement);
    await waitFor(() => expect(clock.timers.size).toBe(1));
    await act(async () => {
      clock.advance();
      await Promise.resolve();
    });
    await waitFor(() => expect(clock.request).toHaveBeenCalledTimes(1));
    await userEvent.click(
      canvas.getByRole("button", { name: "Другой объект удаления" }),
    );
    await act(async () => {
      clock.respond(0, "deleted");
      await Promise.resolve();
    });
    await expect(canvas.queryByText(/удалено из Kinescope/u)).toBeNull();
    await expect(canvas.getByText(/Другой урок/u)).toBeVisible();
    await waitFor(() => expect(clock.timers.size).toBe(1));
  },
};

function isTimerCallback(handler: TimerHandler): handler is () => void {
  return typeof handler === "function";
}

function RefreshDeletionTarget(
  args: Parameters<typeof MaterialVideoAuthoring>[0],
) {
  const [target, setTarget] = useState(args.latestVideoDeletion);
  return (
    <>
      <button
        onClick={() => {
          setTarget({ ...deletingVideo });
        }}
      >
        Обновить тот же объект
      </button>
      <MaterialVideoAuthoring {...args} latestVideoDeletion={target} />
    </>
  );
}
export const RefreshSameDeletionWhileReading: Story = {
  render: (args) => <RefreshDeletionTarget {...args} />,
  play: async ({ canvasElement }) => {
    if (polling === undefined) throw new Error("Polling clock is required");
    const clock = polling;
    const canvas = within(canvasElement);
    await waitFor(() => expect(clock.timers.size).toBe(1));
    await act(async () => {
      clock.advance();
      await Promise.resolve();
    });
    await waitFor(() => expect(clock.request).toHaveBeenCalledTimes(1));
    await userEvent.click(
      canvas.getByRole("button", { name: "Обновить тот же объект" }),
    );
    await waitFor(() => expect(clock.timers.size).toBe(1));
    await act(async () => {
      clock.advance();
      await Promise.resolve();
    });
    await expect(clock.request).toHaveBeenCalledTimes(1);
    await act(async () => {
      clock.respond(0, "deleted");
      await Promise.resolve();
    });
    await waitFor(() => expect(clock.request).toHaveBeenCalledTimes(2));
    clock.respond(1, "deleting");
    await expect(canvas.queryByText(/удалено из Kinescope/u)).toBeNull();
    await waitFor(() => expect(clock.timers.size).toBe(1));
  },
};
