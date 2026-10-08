import { expect, it, vi } from "vitest";

import {
  announceEnrollmentChange,
  subscribeEnrollmentChange,
} from "@/entities/subscription/model/enrollment-events";

it("назначения слышат запись из вкладки с прежним именем канала", async () => {
  let refreshes = 0;
  let delivered: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  const stop = subscribeEnrollmentChange(() => {
    refreshes += 1;
    delivered?.();
  });
  const oldTab = new BroadcastChannel("inside.enrollments.changed");
  try {
    oldTab.postMessage("changed");
    await received;
    expect(refreshes).toBe(1);
  } finally {
    stop();
    oldTab.close();
  }
});

it("запись назначений доходит до вкладки с прежним именем канала", async () => {
  const oldTab = new BroadcastChannel("inside.enrollments.changed");
  const received = new Promise<void>((resolve) => {
    oldTab.addEventListener(
      "message",
      () => {
        resolve();
      },
      { once: true },
    );
  });
  try {
    announceEnrollmentChange();
    await received;
  } finally {
    oldTab.close();
  }
});

it("без межвкладочного канала назначения обновляют соседнюю поверхность и поддерживают отписку", () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("window", new EventTarget());
  const refresh = vi.fn();
  const stop = subscribeEnrollmentChange(refresh);

  announceEnrollmentChange();
  expect(refresh).toHaveBeenCalledTimes(1);
  stop();
  announceEnrollmentChange();
  expect(refresh).toHaveBeenCalledTimes(1);
});
