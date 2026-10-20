import { setImmediate as nextTurn } from "node:timers/promises";
import { expect, test } from "vitest";
import { shutdownApiDeliveryTelemetry } from "../../src/entrypoints/api/api-delivery-lifecycle.js";

function barrier() {
  let release = () => {
    /* assigned by the synchronous Promise constructor */
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test.each([0, 1] as const)(
  "failed pump %s cannot close the SDK while its sibling still drains",
  async (failed) => {
    const entered = barrier();
    const held = barrier();
    const failure = new Error("private-pump-failure");
    let sdkClosed = false;
    const pumps = [0, 1].map((index) => ({
      async onApplicationShutdown() {
        if (index === failed) throw failure;
        entered.release();
        await held.promise;
      },
    }));
    const first = pumps[0],
      second = pumps[1];
    if (first === undefined || second === undefined)
      throw new Error("Fixture owners missing");
    const closing = shutdownApiDeliveryTelemetry([first, second], {
      async shutdown() {
        sdkClosed = true;
      },
    });
    // Observe rejection immediately so a defective early close cannot become an unhandled rejection.
    const outcome = closing.then(
      () => undefined,
      (error: unknown) => error,
    );
    try {
      await entered.promise;
      // This event-loop checkpoint lets already admitted Promise continuations settle, without a time-based wait.
      await nextTurn();
      expect(sdkClosed).toBe(false);
    } finally {
      held.release();
    }
    const error = await outcome;
    expect(sdkClosed).toBe(true);
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError))
      throw new Error("Missing drain failure");
    expect(error.errors).toEqual([failure]);
  },
);

test("both pump failures and SDK cleanup failure survive as the original private error objects", async () => {
  const first = new Error("private-first"),
    second = new Error("private-second"),
    sdk = new Error("private-sdk");
  let sdkCalls = 0;
  const outcome = await shutdownApiDeliveryTelemetry(
    [
      {
        onApplicationShutdown() {
          throw first;
        },
      },
      {
        async onApplicationShutdown() {
          throw second;
        },
      },
    ],
    {
      async shutdown() {
        sdkCalls++;
        throw sdk;
      },
    },
  ).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(sdkCalls).toBe(1);
  expect(outcome).toBeInstanceOf(AggregateError);
  if (!(outcome instanceof AggregateError))
    throw new Error("Missing lifecycle failure");
  expect(outcome.errors).toEqual([first, second, sdk]);
});
