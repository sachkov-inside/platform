import { expect, it } from "vitest";
import {
  ApplicationClose,
  type ProducerLifetime,
} from "../../src/application/application-close.js";
import type { DrainReport } from "../../src/shared/drain-report.js";
import { deferred } from "../support/deferred.js";

/** System lifetime port control, not native worker/PG/SDK evidence. */
function producer(name: string, stages: string[]) {
  const held = deferred();
  let stopped = false;
  let quiet = false;
  const owner: ProducerLifetime = {
    beginStop: () => {
      stopped = true;
      stages.push(`${name}.stop`);
    },
    drain: async () => {
      await held.promise;
      quiet = true;
      stages.push(`${name}.quiet`);
      return { quiescent: true, failures: [] };
    },
    whenQuiescent: async () => {
      await held.promise;
      quiet = true;
    },
    isQuiescent: () => stopped && quiet,
  };
  return { owner, held };
}

it("starts all producer stops before awaiting any owner and preserves every eligible cleanup failure", async () => {
  const stages: string[] = [];
  const http = producer("http", stages);
  const background = producer("background", stages);
  const notification = producer("notification", stages);
  const actions = deferred<DrainReport>();
  const actionsStarted = deferred();
  const workerError = new Error("synthetic worker");
  const sdkError = new Error("synthetic SDK");
  const pgError = new Error("synthetic PG");
  const frameworkError = new Error("synthetic framework");
  background.owner.drain = async () => {
    await background.held.promise;
    stages.push("background.rejected");
    throw workerError;
  };
  const lifetime = new ApplicationClose({
    http: http.owner,
    background: background.owner,
    notifications: notification.owner,
    actions: {
      drain: () => {
        actionsStarted.resolve();
        return actions.promise;
      },
      whenQuiescent: async () => {
        await actions.promise;
      },
    },
    telemetry: () => {
      stages.push("sdk");
      return Promise.reject(sdkError);
    },
    database: () => {
      stages.push("pg");
      throw pgError;
    },
    framework: () => {
      stages.push("framework");
      return Promise.reject(frameworkError);
    },
  });
  const closing = lifetime.close();
  const observed = closing.catch((error: unknown) => error);
  try {
    expect(stages).toEqual([
      "http.stop",
      "background.stop",
      "notification.stop",
    ]);
    expect(lifetime.close()).toBe(closing);
    background.held.resolve();
    http.held.resolve();
    await Promise.resolve();
    expect(stages).not.toContain("sdk");
    expect(stages).not.toContain("pg");
    notification.held.resolve();
    await actionsStarted.promise;
    expect(stages).not.toContain("sdk");
    actions.resolve({ quiescent: true, failures: [] });
    const error: unknown = await observed;
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError))
      throw new Error("Missing private aggregate");
    expect(error.errors).toEqual([
      workerError,
      sdkError,
      pgError,
      frameworkError,
    ]);
    expect(stages.slice(-3)).toEqual(["sdk", "pg", "framework"]);
  } finally {
    http.held.resolve();
    background.held.resolve();
    notification.held.resolve();
    actions.resolve({ quiescent: true, failures: [] });
    await observed;
  }
});

it("publishes the one close promise before a synchronous stop callback can reenter close", async () => {
  const stages: string[] = [];
  const http = producer("http", stages);
  const background = producer("background", stages);
  const notification = producer("notification", stages);
  for (const owner of [http, background, notification]) owner.held.resolve();
  let reentered: Promise<void> | undefined;
  let entered = false;
  const beginStop = http.owner.beginStop.bind(http.owner);
  http.owner.beginStop = () => {
    beginStop();
    if (!entered) {
      entered = true;
      reentered = lifetime.close();
    }
  };
  let disposals = 0;
  const lifetime = new ApplicationClose({
    http: http.owner,
    background: background.owner,
    notifications: notification.owner,
    actions: {
      drain: () => Promise.resolve({ quiescent: true, failures: [] }),
      whenQuiescent: () => Promise.resolve(),
    },
    telemetry: () => Promise.resolve(),
    database: () => Promise.resolve(),
    framework: () => {
      disposals += 1;
      return Promise.resolve();
    },
  });
  const closing = lifetime.close();
  expect(reentered).toBe(closing);
  await closing;
  expect(disposals).toBe(1);
});
