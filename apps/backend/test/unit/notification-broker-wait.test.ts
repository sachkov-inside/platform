import { expect, test } from "vitest";
import { connectWhenBrokerReady } from "../../src/infrastructure/notification-transport/worker.js";

/** Virtual time: each pause only moves the clock forward. */
function virtualClock() {
  let now = 0;
  const pauses: number[] = [];
  return {
    pauses,
    now: () => now,
    pause: (milliseconds: number) => {
      pauses.push(milliseconds);
      now += milliseconds;
      return Promise.resolve();
    },
  };
}
const refused = () =>
  Object.assign(new Error("connect ECONNREFUSED 172.21.0.2:5671"), {
    code: "ECONNREFUSED",
  });

test("waits for a broker that starts after the worker and reports the wait without operator attention", async () => {
  const clock = virtualClock();
  const reports: Record<string, unknown>[] = [];
  let attempts = 0;
  const connection = await connectWhenBrokerReady(
    () => {
      attempts += 1;
      return attempts < 4 ? Promise.reject(refused()) : Promise.resolve("up");
    },
    {
      principal: "notifications",
      report: (event) => reports.push(event),
      now: clock.now,
      pause: clock.pause,
    },
  );
  expect(connection).toBe("up");
  expect(attempts).toBe(4);
  expect(clock.pauses).toEqual([1_000, 2_000, 4_000]);
  expect(reports).toEqual([
    expect.objectContaining({
      status: "transport_waiting",
      reason: "notification_broker_unavailable",
      principal: "notifications",
    }),
  ]);
});

test("gives up after two minutes and leaves the failure to the caller", async () => {
  const clock = virtualClock();
  const reports: Record<string, unknown>[] = [];
  await expect(
    connectWhenBrokerReady(() => Promise.reject(refused()), {
      principal: "billing",
      report: (event) => reports.push(event),
      now: clock.now,
      pause: clock.pause,
    }),
  ).rejects.toThrow("ECONNREFUSED");
  expect(clock.now()).toBeGreaterThanOrEqual(120_000);
  expect(Math.max(...clock.pauses)).toBe(5_000);
  expect(
    reports.every((event) => event["status"] !== "operator_attention"),
  ).toBe(true);
});

test("a stop during the wait ends it at once", async () => {
  const clock = virtualClock();
  const stop = new AbortController();
  let attempts = 0;
  await expect(
    connectWhenBrokerReady(
      () => {
        attempts += 1;
        if (attempts === 2) stop.abort();
        return Promise.reject(refused());
      },
      {
        principal: "email",
        report: () => undefined,
        now: clock.now,
        pause: clock.pause,
        signal: stop.signal,
      },
    ),
  ).rejects.toThrow("ECONNREFUSED");
  expect(attempts).toBe(2);
});
