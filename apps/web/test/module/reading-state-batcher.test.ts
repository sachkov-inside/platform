import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReadingStateBatcher } from "@/features/reading-progress/model/reading-state-batcher";

const state = (materialId: string) => ({ isRead: false, materialId, readAt: null, updatedAt: null, version: 1 });

describe("reading state batcher", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("reads every Material requested in one tick with one request", async () => {
    const load = vi.fn((ids: readonly string[]) => Promise.resolve({ kind: "ready" as const, states: ids.map(state) }));
    const read = createReadingStateBatcher(load);

    const pending = Promise.all([read("b"), read("a"), read("a")]);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual([state("b"), state("a"), state("a")]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(["a", "b"]);
  });

  it("splits a large set by the BFF limit", async () => {
    const load = vi.fn((ids: readonly string[]) => Promise.resolve({ kind: "ready" as const, states: ids.map(state) }));
    const read = createReadingStateBatcher(load);

    const pending = Promise.all(Array.from({ length: 101 }, (_, index) => read(`m${String(index).padStart(3, "0")}`)));
    await vi.runAllTimersAsync();
    await pending;

    expect(load.mock.calls.map(([ids]) => ids.length)).toEqual([100, 1]);
  });

  it("fails the whole batch when the answer does not describe exactly what was asked", async () => {
    const read = createReadingStateBatcher(() => Promise.resolve({ kind: "ready" as const, states: [state("a"), state("a")] }));

    const pending = Promise.allSettled([read("a"), read("b")]);
    await vi.runAllTimersAsync();

    expect((await pending).map((result) => result.status)).toEqual(["rejected", "rejected"]);
  });

  it("reports an unavailable read as a failure instead of an empty state", async () => {
    const read = createReadingStateBatcher(() => Promise.resolve({ kind: "unavailable" as const }));

    const pending = read("a");
    const settled = expect(pending).rejects.toThrow("unavailable");
    await vi.runAllTimersAsync();

    await settled;
  });
});
