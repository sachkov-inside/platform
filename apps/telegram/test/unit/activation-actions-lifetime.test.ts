import { expect, it } from "vitest";
import { ActivationActions } from "../../src/modules/subscription-activation/activation-actions.js";
import { deferred } from "../support/deferred.js";

it("waits for a started timeout fallback after the original action wins its race", async () => {
  const owner = new ActivationActions();
  const work = deferred();
  const fallback = deferred();
  const action = owner.track(work.promise);
  const timeoutFailure = owner.track(fallback.promise);
  const returned = Promise.race([action, timeoutFailure]);
  work.resolve();
  await returned;
  let drained = false;
  const closing = owner.drain().then((report) => {
    drained = true;
    return report;
  });
  try {
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(owner.isQuiescent()).toBe(false);
    fallback.resolve();
    expect(await closing).toEqual({ quiescent: true, failures: [] });
    expect(owner.isQuiescent()).toBe(true);
  } finally {
    work.resolve();
    fallback.resolve();
    await closing;
  }
});

it("drains descendants and preserves their original rejection privately", async () => {
  const owner = new ActivationActions();
  const original = deferred();
  const child = deferred();
  const childStarted = deferred();
  const failure = new Error("synthetic action failure");
  const outer = owner.track(
    (async () => {
      await original.promise;
      const result = owner.track(child.promise);
      void result.catch(() => undefined);
      childStarted.resolve();
    })(),
  );
  const closing = owner.drain();
  try {
    original.resolve();
    await childStarted.promise;
    await outer;
    expect(owner.isQuiescent()).toBe(false);
    child.reject(failure);
    const report = await closing;
    expect(report.failures).toEqual([failure]);
    expect(report.failures[0]).toBe(failure);
  } finally {
    original.resolve();
    child.resolve();
    await closing;
  }
});
